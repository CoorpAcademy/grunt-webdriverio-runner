'use strict';

module.exports = function reporter(runner, output) {
    this.output = output;

    if (!runner) {
        return;
    }
    this.stats = {
        suites: 0, tests: 0, passes: 0, pending: 0, failures: 0, total: runner.total
    };

    // notify new test
    output({
        progress: {
            max:  this.stats.total,
            index: runner.index
        }
    });

    var failures = [];

    runner.on('start', function() {
        this.stats.start = new Date();
    }.bind(this));

    runner.on('suite', function(suite) {
        this.stats.suites = this.stats.suites || 0;
        suite.root || this.stats.suites++;
    }.bind(this));

    runner.on('test end', function(test) {
        this.stats.tests = this.stats.tests || 0;
        this.stats.tests++;
        output({
            progress: {
                index: runner.index
            }
        });
    }.bind(this));

    runner.on('pass', function(test) {
        this.stats.passes = this.stats.passes || 0;

        var medium = test.slow() / 2;
        test.speed = test.duration > test.slow() ? 'slow' : test.duration > medium ? 'medium' : 'fast';

        this.stats.passes++;
    }.bind(this));

    runner.on('fail', function(test, err) {
        this.stats.failures = this.stats.failures || 0;
        this.stats.failures++;
        test.err = err;
        failures.push(test);
    }.bind(this));

    runner.on('end', function() {
        this.stats.end = new Date();
        this.stats.duration = new Date() - this.stats.start;
    }.bind(this));

    runner.on('pending', function() {
        this.stats.pending++;
    }.bind(this));
};
