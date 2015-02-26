'use strict';

var Mocha = require('mocha');
var _ = require('lodash');
var Promise = require('bluebird');
var webdriverio = require('webdriverio');
var SauceLabs = require('saucelabs');
var chai = require('chai');
var args = process.argv;
var capabilities = JSON.parse(args[2]);
var mochaOptions = capabilities;
var testFiles = capabilities.tests;
var commandHelpersFiles = capabilities.commandHelpers;
var debug = require('debug')('webdriver.io:process');
var Reporter = require('./reporter');
var exitCode = 0;
function output(msg) {
    process.send(msg);
}

// function printLog(/* arguments */) {
//     var args = Array.prototype.slice.call(arguments);
//     args.push('[' + testName + ']');
//     console.log.apply(console, args);
// }
// function printError(/* arguments */) {
//     var args = Array.prototype.slice.call(arguments);
//     args.push('[' + testName + ']');
//     console.error.apply(console, args);
// }

var wdclient = webdriverio.remote(capabilities);

commandHelpersFiles.forEach(function(file) {
    var module = require(file);
    var methods = _.functions(module);
    methods.forEach(function(method) {
        wdclient.addCommand(method, module[method].bind(wdclient));
    });
});

Promise.promisifyAll(wdclient, {suffix: 'ify'});
Promise.promisifyAll(SauceLabs.prototype);

_.bindAll(wdclient);

GLOBAL.client = wdclient;
GLOBAL.expect = chai.expect;
GLOBAL.throwIfErr = function(err) {
    if (err) {
        console.error('here is error ' + err);
        throw err;
    }
};
/**
 * initialize Mocha
 */
var mocha = new Mocha(mochaOptions);
debug('mocha options', mochaOptions);
// Promise.promisifyAll(mocha, {suffix: 'ify'});

// _.bindAll(mocha);

_.forEach(testFiles, function(file) {
    mocha.addFile(file);
});

var uncaughtExceptionHandlers = process.listeners('uncaughtException');
process.removeAllListeners('uncaughtException');
// /*istanbul ignore next*/
// var unmanageExceptions = function() {
//     uncaughtExceptionHandlers.forEach(process.on.bind(process, 'uncaughtException'));
// };

wdclient.capabilities = capabilities;

var updateJobStatus = Promise.method(function(exitCode) {
    debug('update jobs', '#' + capabilities.index, 'with exitCode', exitCode, ' sessionID : ',
        wdclient.requestHandler.sessionID);
    // if we have a sauce id then update status
    if (capabilities.updateSauceJob && wdclient.requestHandler.sessionID) {
        var sauceAccount = new SauceLabs({
            username: capabilities.user,
            password: capabilities.key
        });
        debug('updateJob ', wdclient.requestHandler.sessionID, exitCode);
        return sauceAccount.updateJobAsync(wdclient.requestHandler.sessionID, {
            passed: exitCode === 0
        });
    }
    if (capabilities.updateBrowserstackSession && wdclient.requestHandler.sessionID) {
        var request = Promise.promisify(require('request'));
        debug('updateSession ', wdclient.requestHandler.sessionID, exitCode);
        // http://www.browserstack.com/automate/rest-api#rest-api-sessions
        return request({
            url: 'https://www.browserstack.com/automate/sessions/' + wdclient.requestHandler.sessionID + '.json',
            method: 'PUT',
            json: true,
            body: {status: exitCode === 0 ? 'completed' : 'error'},
            auth: {
                user: capabilities.user,
                pass: capabilities.key,
                sendImmediately: true
            }
        });
    }
    return true;
});

process.on('SIGINT', function() {
    debug('updating jobs', '#' + capabilities.index, 'SIGINT');
    // Setting code status to 2 when interruption required
    updateJobStatus(2).then(function() {
        debug('updated jobs', '#' + capabilities.index, 'SIGINT');
    });
});

wdclient.initify()
    .then(function() {
        debug('init pid [', process.pid, '] sessionID [', wdclient.requestHandler.sessionID, ']');
        return wdclient.timeoutsImplicitWaitify(capabilities.timeoutsImplicitWait);
    })
    .then(function() {
        return wdclient.timeoutsAsyncScriptify(capabilities.timeoutsAsyncScript);
    })
    .then(function(res) {
        if (!capabilities.desiredCapabilities['browser-resolution'] || wdclient.isMobile) {
            return true;
        }
        var screenResolution = capabilities.desiredCapabilities['browser-resolution'].split('x');
        // var handle = res.value.replace('{', '').replace('}', '');
        debug('switching to windows size', capabilities.desiredCapabilities['browser-resolution']);
        return wdclient.windowHandleSizeify({width: parseInt(screenResolution[0]),
            height: parseInt(screenResolution[1])});
    })
    .then(function() {
        return new Promise(function(resolve, reject) {
            var runner = mocha.run(function(failures) {
                if (failures) {
                    return reject(failures);
                }
                return resolve();
            });
            // pass index to help notify on process parent
            runner.index = capabilities.index;

            var runnerProgress = new Reporter(runner, output);
        });
    })
    .catch(function(err) {
        exitCode = 1;
        debug('catch pid [', process.pid, '] sessionID [', wdclient.requestHandler.sessionID, ']');
        if ((err.message && err.message.indexOf('Please upgrade to add more parallel sessions') >= 0) ||
            (typeof err.indexOf === 'function' && err.indexOf('Please upgrade to add more parallel sessions') >= 0)) {
            exitCode = 3;
        }
        else {
            if (err.message) {
                console.error(err.stack || err);
            }
        }
        updateJobStatus(exitCode).then(function() {
            debug('carefully stopped pid [', process.pid, '] sessionID [', wdclient.requestHandler.sessionID, ']');
        });
    })
    .then(function() {
        if (exitCode > 0 && exitCode !== 3) {
            return wdclient.logify('browser')
                .then(function(result) {
                    console.log('Browser logs:');
                    if (!result || !result.value || result.value.length === 0) {
                        console.log('logs are empty');
                        return;
                    }
                    result.value.forEach(function(line) {
                        console.log('[' + line.timestamp + ']', '[' + line.level + ']', line.message);
                    });
                })
                .catch(function(err) {
                    console.log('Unable to get browser logs (not supported on this driver)');
                })
            ;
        }
    })
    .then(function() {
        debug('updateJobStatus then return for ' + exitCode);
        return updateJobStatus(exitCode);
    })
    .finally(wdclient.endify)
    .finally(function() {
        setTimeout(function() {
            debug('waiting for exit pid [', process.pid, '] sessionID [', wdclient.requestHandler.sessionID, ']');
            process.exit(exitCode);
        }, 1000);
    })
;
