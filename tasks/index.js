'use strict';
var _ = require('lodash');
var fork = require('child_process').fork;
var path = require('path');
var async = require('async');
var chalk = require('chalk');
var debug = require('debug')('webdriver.io:runner');
var Progress = require('./lib/progress');

module.exports = function(grunt) {
    grunt.registerMultiTask('webdriver', 'run WebdriverIO tests with Mocha', function() {
        grunt.log.verbose.writeln(this.options());
        var done = this.async();
        var options = _.extend({
            reporter: 'spec',
            ui: 'bdd',
            slow: 75,
            bail: false,
            grep: null,
            timeout: 1000000,
            updateSauceJob: false,
            output: null,
            quiet: false,
            nospawn: false,
            timeoutsImplicitWait: 0,
            maxSessions: 0
        }, this.options());

        var testFiles = [];
        var commandHelpersFiles = [];
        // used to know position in muti browser test
        var capabilitiesIndex = 0;

        grunt.file.setBase(process.cwd());

        grunt.file.expand(options.tests).forEach(function(file) {
            testFiles.push(file);
        });

        grunt.file.expand(options.commandHelpers).forEach(function(file) {
            commandHelpersFiles.push(path.resolve(file));
        });

        var capabilitiesDone = 0;
        var forksCache = [];
        var desiredCapabilities = _.clone(options.desiredCapabilities);

        var progress = new Progress(desiredCapabilities.length);

        var upperCaseFirst = function(string) {
            if (!string) {
                return;
            }
            return string.charAt(0).toUpperCase() + string.slice(1);
        };

        /**
         * convert capability from saucelabs to browserstack
         * https://www.browserstack.com/automate/node
         * https://docs.saucelabs.com/reference/platforms-configurator/#/
         * @param  {[type]} capability [description]
         * @return {[type]}            [description]
         */
        var sauce2browserstack = function(capability) {
            /* IOS */
            if (capability.platformName === 'iOS') {
                capability.platform = 'MAC';
                capability.browserName = 'iPhone';
                return capability;
            }

            /* ANDROID */
            if (capability.browserName === 'android') {
                capability.browserName = 'android';
                capability.platform = 'ANDROID';
                if (!capability.device) {
                    // hard to convert from sauce device to browserstack device.
                    // try remove Emulator
                    capability.device = capability.deviceName.replace(' Emulator', '');
                }
                delete capability.deviceName;
                return capability;
            }

            if (capability['screen-resolution']) {
                capability.resolution = capability['screen-resolution'];
            }

            var os = capability.platform.split(' ');

            if (capability.platform.indexOf('Windows') >= 0) {
                capability.os  = os[0];
                capability.os_version = os[1];
            }

            if (capability.platform.indexOf('Mac') >= 0) {
                capability.os  = 'OS X';
                switch (os[1]) {
                    case '10.6':
                    capability.os_version = 'Snow Leopard';
                    break;
                    case '10.7':
                    capability.os_version = 'Lion';
                    break;
                    case '10.8':
                    capability.os_version = 'Mountain Lion';
                    break;
                    case '10.9':
                    capability.os_version = 'Mavericks';
                    break;
                    case '10.10':
                    capability.os_version = 'Yosemite';
                    break;
                }
            }
            if (capability.version) {
                capability.browser_version = capability.version.indexOf('.') >= 0 ?
                    capability.version : capability.version + '.0';
            }
            capability.browser = upperCaseFirst(capability.browserName);
            return capability;
        };

        var getLines = function(data) {
            if (!data) {
                return [];
            }
            return data.toString().split('\n');
        };

        var launchFork = function(options, grunt, next) {
            grunt.log.verbose.writeln('starting webdriver with options', options);
            var desiredCapability = options.desiredCapabilities;
            if (desiredCapability.debugProcess) {
                grunt.log.writeln('debugging process with args', desiredCapability.debugProcess);
                process.execArgv.push(desiredCapability.debugProcess);
            }
            var webdriverioProcess = fork(path.join(__dirname, '/lib/process'),
                    [JSON.stringify(options)],
                    {
                        env: process.env,
                        silent: true,
                        cwd: process.cwd()
                    })
                ;

                var stdout = '';
                var stderr = '';

                webdriverioProcess.on('message', function(message) {
                    if (message.progress) {
                        if (message.progress.max) {
                            // prepare the progress bar
                            return progress.initBar(desiredCapability.testName,
                                message.progress.index,
                                message.progress.max);
                        }
                        progress.tick(desiredCapability.testName, message.progress.index);
                    }
                });

                webdriverioProcess.stdout.on('data', function(data) {
                    stdout += data;
                    // var lines = getLines(data);
                    // lines.forEach(function(line) {
                    //     if (!line || line.length === 0) {
                    //         return;
                    //     }
                    //     stdout.push(chalk.stripColor(line));
                    // });
                });

                webdriverioProcess.stderr.on('data', function(data) {
                    stderr += data;
                    // var lines = getLines(data);
                    // lines.forEach(function(line) {
                    //     if (!line || line.length === 0) {
                    //         return;
                    //     }
                    //     stderr.push(chalk.stripColor(line));
                    // });
                });

                webdriverioProcess.on('close', function(code) {
                    var testNameFormated = '[' + desiredCapability.testName + ']';
                    // stdout.forEach(function(line) {
                    if (stdout) {
                        grunt.log.subhead(testNameFormated + ' RESULT');
                        grunt.log.writeln(stdout);
                    }
                    // });
                    // stderr.forEach(function(line) {
                    if (stderr) {
                        grunt.log.subhead(chalk.red(testNameFormated + ' ERROR'));
                        grunt.log.error(stderr);
                    }
                    // });
                    // other error
                    if (code !== 0) {
                        // error code when reached browserstack limit
                        // Problem: x (currently 10) sessions are currently being used.
                        // Please upgrade to add more parallel sessions
                        if (code === 3) {
                            // restart the test
                            grunt.log.error(testNameFormated + ' failed, test queued, retrying in 1 minute');
                            return setTimeout(function() {
                                webdriverioProcess = launchFork(options, grunt, next);
                            },
                            60 * 1000);
                        }
                        else {
                            return next(new Error('ps process exited with code ' + code));
                        }
                    }
                    next();
                });
            return webdriverioProcess;
        };

        desiredCapabilities.forEach(function(desiredCapability) {
            desiredCapability.index = capabilitiesIndex;
            var testNameParts = [];
            testNameParts.push(desiredCapability.browserName);
            testNameParts.push(desiredCapability.platformVersion || desiredCapability.version);
            testNameParts.push(desiredCapability.platformName ||  desiredCapability.platform);
            var testName = _.without(testNameParts, '', undefined, null).join(' ');
            desiredCapability.testName = testName;
            capabilitiesIndex++;
        });

        async.eachLimit(desiredCapabilities, options.maxSessions, function(item, next) {
            debug('starting new test #' + item.index);
            var desiredCapability = _.clone(options);
            // flat to one capability for webdriver.io
            if (options.host && options.host.indexOf('browserstack')) {
                item = sauce2browserstack(item);
            }
            desiredCapability.index = item.index;
            desiredCapability.desiredCapabilities = item;
            desiredCapability.tests = testFiles;
            desiredCapability.commandHelpers = commandHelpersFiles;
            var fork = launchFork(desiredCapability, grunt, next);
            forksCache.push(fork);
            debug('spawing fork with pid : ', fork.pid);
        }, function(err) {
            progress.destroy();
            if (err) {
                grunt.log.error(err.stack || err);
            }
            if (options.bail) {
                forksCache.forEach(function(fork) {
                    debug('sending SIGINT signal to ', fork.pid);
                    fork.kill('SIGINT');
                });
                debug('wait a little while cleaning forks');
                setTimeout(function() {
                    process.nextTick(process.nextTick.bind(process, done.bind(null, err)));
                }, 1000);
            }
        });
    });
};
