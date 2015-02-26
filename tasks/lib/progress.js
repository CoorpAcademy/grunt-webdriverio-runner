'use strict';

var progress = function progress(length) {
    console.log('Starting to test ' + length + ' browser(s)');
    this.bars = new Array(length);
};

progress.prototype.initBar = function(testName, index, max) {
    console.log('[' + testName + ']', max , 'pending tests');
    this.bars[index] = max;
};

progress.prototype.tick = function(testName, barIndex) {
    this.bars[barIndex]--;
    var remaining = this.bars[barIndex];
    if (remaining === 0) {
        console.log('[' + testName + '] ending tests');
    }
    else {
        console.log('[' + testName + ']', this.bars[barIndex] , 'pending tests');
    }
};

progress.prototype.destroy = function() {
    this.bars = null;
};

module.exports = progress;
