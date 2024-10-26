export {
    Range, Range as r
};

/**
* @param {number} a
* @param {number} b
* @returns {number[]}
*/
function Range(a, b) {
    if (b === undefined) {
        b = a; a = 0;
    }
    const arr = [];
    for (let i = a; i < b; i++) {
        arr.push(i);
    }
    return arr;
}
