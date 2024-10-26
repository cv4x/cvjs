import htm from "htm";
import { Signal } from "signal-polyfill";
import { Effect } from "signal-effect";

const html = htm.bind(virtualizeTemplate);

export * from "util";
export {
    Computed,
    Effect,
    State,
    html,
    render,
    virtualize, processTemplate
};

/**
* @typedef {Object} VirtualNodeParams
* @prop {Renderer} renderer
* @prop {AttributeMap} [attributes]
* @prop {EventMap} [events]
* @prop {Virtual[]} [children]
* @prop {DOMNode} [node]
*/

/**
* @prop {Renderer} renderer
* @prop {AttributeMap} attributes
* @prop {EventMap} events
* @prop {Virtual[]} children
* @prop {DOMNode} [node]
*/
class VirtualNode {
    constructor(/** @type {VirtualNodeParams} */object) {
        this.renderer = object.renderer;
        this.attributes = object.attributes || {};
        this.events = object.events || {};
        this.children = object.children || [];
        this.node = object.node;
        Object.seal(this);
    }
}

/** @typedef {HTMLElement|Text} DOMNode */

/** @typedef {()=>DOMNode} Renderer */
/** @typedef {Record.<string,unknown>} AttributeMap */
/** @typedef {Record.<string,EventListener>} EventMap */
/** @typedef {string|number|boolean} Member */
/** @typedef {VirtualNode|Member} Virtual */
/** @typedef {string|number|boolean|EventListener} PropertyValue */

/**
* @typedef {Object} ComponentArgs
* @prop {string} [tag]
* @prop {AttributeMap} [attributes]
* @prop {EventMap} [events]
* @prop {unknown[]} [children]
*/

/** @typedef {(args?:ComponentArgs)=>VirtualNode} Component */

/**
* @param {any} value
* @returns {Signal.State}
*/
function State(value) {
    return new Signal.State(value);
}

/**
* @param {()=>void|(()=>()=>void)} callback
* @returns {Signal.Computed}
*/
function Computed(callback) {
    return new Signal.Computed(callback);
}

/**
* @param {Signal.State|Signal.Computed|DOMNode} source
* @returns {Promise<Virtual>}
*/
async function virtualize(source) {
    if (source instanceof Signal.State || source instanceof Signal.Computed) {
        return virtualizeSignal(source);
    }

    if (source instanceof HTMLElement || source instanceof Text) {
        const virtual = await virtualizeDom(source);
        render(virtual);
        return virtual;
    }
}

/**
* @param {Signal.State|Signal.Computed} signal
* @returns {VirtualNode}
*/
function virtualizeSignal(signal) {
    const virtual = new VirtualNode({
        renderer: function () {
            const rendered = render(signal.get());
            if (Array.isArray(rendered)) {
                const div = window.document.createElement("div");
                div.append(...rendered);
                return div;
            }
            return rendered;
        }
    });

    let firstRun = true;
    const cleanup = Effect(((/** @type {VirtualNode} */v) => {
        if (!firstRun && !document.contains(v.node)) {
            return cleanup();
        }
        render(virtual);
        firstRun = false;
    }).bind(null, virtual));

    return virtual;
}

/**
* @param {string|Component|Signal} tag
* @param {Record.<string,PropertyValue>} [properties]
* @param {...unknown} [children]
* @returns {VirtualNode}
*/
function virtualizeTemplate(tag, properties, ...children) {
    const [attributes, events] = mapProperties(properties || {});
    if (typeof tag === "function") {
        return tag({ attributes, events, children });
    }

    if (tag instanceof Signal.State || tag instanceof Signal.Computed) {
        return virtualizeSignal(tag);
    }

    /** @type {Renderer} */
    const renderer = window.document.createElement.bind(window.document, tag || "div");

    const virtualChildren = children.map(childMapper).flat().filter(child => child !== undefined);

    return new VirtualNode({
        renderer,
        attributes,
        events,
        children: virtualChildren
    });

    /**
    * @param {Record.<string,PropertyValue>} properties
    * @returns {[AttributeMap, EventMap]}
    */
    function mapProperties(properties) {
        /** @type AttributeMap */
        const attributes = {};
        /** @type EventMap */
        const events = {};

        for (let [prop,val] of Object.entries(properties)) {
            prop = prop.toLocaleLowerCase();
            if (prop.startsWith("on") && typeof val === "function") {
                events[prop.substring(2).toLocaleLowerCase()] = val;
            } else {
                attributes[prop] = val;
            }
        }

        return [ attributes, events ];
    }

    /**
    * @param {unknown} child
    * @returns {Virtual|Virtual[]}
    */
    function childMapper(child) {
        if (Array.isArray(child)) {
            return child.map(childMapper).flat();
        }

        if (typeof child === "string" || typeof child === "number" || typeof child === "boolean") {
            return child;
        }

        if (typeof child === "function") {
            return childMapper(child());
        }

        if (child instanceof Signal.State || child instanceof Signal.Computed) {
            return virtualizeSignal(child);
        }

        return /** @type {Virtual} */(child);
    }
}

/**
* @param {DOMNode} element
* @returns {Promise<Virtual|string>}
*/
async function virtualizeDom(element) {
    if (element instanceof Text) {
        return element.textContent;
    }

    const moduleName = element.attributes.getNamedItem("module")?.value;
    /** @type {Component} */
    let module;
    if (moduleName) {
        element.attributes.removeNamedItem("module")
        module = await import(moduleName).then(module => {
            const exportName = element.attributes.getNamedItem("export")?.value;
            if (exportName) {
                element.attributes.removeNamedItem("export")
                return module[exportName];
            } else {
                return module.default;
            }
        });
    } else {
        module = window.document.createElement.bind(window.document, element.tagName);
    }

    const attributes = Array.from(element.attributes)
        .reduce((attributeMap, attribute) => {
            if (!attribute.name.startsWith("on")) {
                attributeMap[attribute.name] = attribute.value;
            }
            return attributeMap;
        }, /** @type {AttributeMap} */({}));

    const virtual = module(/** @type {ComponentArgs} */({
        tag: element.tagName,
        attributes,
        children: Array.from(element.childNodes).filter(child => [1,3].includes(child.nodeType))
    }));

    virtual.attributes = attributes;
    virtual.node = element;
    return virtual;
}

/**
* @param {Virtual} virtual
* @param {VirtualNode|HTMLElement} [parent]
* @returns {DOMNode|DOMNode[]}
*/
function render(virtual, parent) {
    if (Array.isArray(virtual)) {
        if (parent) {
            return virtual.map(child => render(child, parent)).flat();
        } else {
            return divify(virtual);
        }
    }

    if (virtual instanceof Signal.State || virtual instanceof Signal.Computed) {
        return render(virtualizeSignal(virtual));
    }

    if (!(virtual instanceof VirtualNode)) {
        return window.document.createTextNode(String(virtual));
    }

    let node = virtual.renderer();
    if (node instanceof HTMLElement) {
        addAttributesTo(node, virtual.attributes);
        addEventsTo(node, virtual.events);

        const children = virtual.children.map(child => render(child, virtual)).flat();

        node.append(...children);
    }

    if (virtual.node && !parent) {
        const focusInfo = findFocus(virtual.node);

        virtual.node.replaceWith(node);

        if (focusInfo && node instanceof HTMLElement) {
            // window.queueMicrotask(() =>
                refocus(node, focusInfo)
            // );
        }
    }

    return virtual.node = node;

    /**
    * @typedef {Object} FocusInfo
    * @prop {number[]} [indices]
    * @prop {string} [key]
    * @prop {boolean} [focusSelf]
    * @prop {string} [tag]
    * @prop {SelectionInfo} [selection]
    */

    /**
    * @typedef {Object} SelectionInfo
    * @prop {"forward"|"backward"|"none"} direction
    * @prop {number} start
    * @prop {number} end
    */

    /**
    * @param {DOMNode} node
    * @returns {FocusInfo}
    */
    function findFocus(node) {
        let current = document.activeElement;
        if (current === window.document.body) {
            return;
        }

        const tag = current.tagName;
        const selection = getSelectionInfo(current);
        if (node === current) {
            return { focusSelf: true, tag, selection };
        }

        const key = current.attributes.getNamedItem("key")?.value;
        const steps = [];
        while (current !== node) {
            if (current === window.document.body) {
                return;
            }
            steps.push(current);
            current = current.parentElement;
        }

        const indices = [];
        for (let step of steps) {
            let i = 0;
            while (step.previousElementSibling) {
                step = step.previousElementSibling;
                i++;
            }
            indices.push(i);
        }

        return { indices, key, tag, selection };
    }

    /**
    * @param {Element} node
    * @returns {SelectionInfo}
    */
    function getSelectionInfo(node) {
        if (node instanceof HTMLInputElement) {
            return {
                direction: node.selectionDirection,
                start: node.selectionStart,
                end: node.selectionEnd
            }
        }
    }

    /**
    * @param {HTMLElement} node
    * @param {FocusInfo} focusInfo
    */
    function refocus(node, focusInfo) {
        if (!focusInfo.focusSelf) {
            const { indices, key } = focusInfo;
            while (indices.length) {
                if (indices.length === 1 && key) {
                    const withKey = Array.from(node.children).find(child =>
                        child.attributes.getNamedItem("key")?.value === key);
                    if (withKey instanceof HTMLElement) {
                        node = withKey;
                        break;
                    }
                }

                const child = node.children[indices.shift()];
                if (!(child instanceof HTMLElement)) {
                    node = null;
                    break;
                }
                node = child;
            }
        }

        if (node) {
            const { tag, selection } = focusInfo;
            node.focus();
            if (node instanceof (HTMLInputElement) && selection) {
                node.selectionDirection = selection.direction;
                node.selectionStart = selection.start;
                node.selectionEnd = selection.end;
            }
        }
    }

    /**
    * @param {HTMLElement} element
    * @param {AttributeMap} attributes
    */
    function addAttributesTo(element, attributes) {
        for (let [prop,val] of Object.entries(attributes)) {
            if (typeof val === "function") {
                val = val();
            }

            if (val instanceof Signal.State || val instanceof Signal.Computed) {
                const signal = val;
                let firstRun = true;
                const cleanup = Effect(() => {
                    if (!firstRun && !document.contains(element)) {
                        return cleanup();
                    }
                    setAttributeOn(element, prop, signal.get());
                    firstRun = false;
                });
                val = signal.get();
            }

            setAttributeOn(element, prop, val);
        }
    }

    /**
    * @param {HTMLElement} element
    * @param {string} prop
    * @param {unknown} val
    */
    function setAttributeOn(element, prop, val) {
        if (element instanceof HTMLInputElement && prop === "value") {
            element.value = String(val);
        } else if (typeof val === "boolean") {
            element.toggleAttribute(prop, val);
        } else {
            element.setAttribute(prop, String(val));
        }
    }

    /**
    * @param {HTMLElement} element
    * @param {EventMap} events
    */
    async function addEventsTo(element, events) {
        for (let [prop,val] of Object.entries(events)) {
            element.addEventListener(prop, val);
        }
    }

    /**
    * @param {Virtual[]} children
    * @returns {HTMLDivElement}
    */
    function divify(children) {
        const div = window.document.createElement("div");
        const rendered = children.map(child => render(child, div)).flat();
        div.append(...rendered);
        return div;
    }
}
