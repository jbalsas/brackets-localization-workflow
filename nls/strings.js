/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define */

define(function (require, exports, module) {
    
    "use strict";
    
    // Code that needs to display user strings should call require("strings") to load
    // src/strings.js. This file will dynamically load strings.js for the specified brackets.locale.
    //
    // See the README.md file in this folder for information on how to add a new translation for
    // another language or locale.
    //
    // TODO: dynamically populate the local prefix list below?
    module.exports = {
        root: true,
        "es": true
    };
});
