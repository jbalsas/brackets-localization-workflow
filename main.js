/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, brackets, $, Mustache */

define(function (require, exports, module) {
    'use strict';
    
    var DocumentManager         = brackets.getModule("document/DocumentManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        Commands                = brackets.getModule("command/Commands"),
        CommandManager          = brackets.getModule("command/CommandManager"),
        Menus                   = brackets.getModule("command/Menus"),
        FileUtils               = brackets.getModule("file/FileUtils"),
        NativeFileSystem        = brackets.getModule("file/NativeFileSystem").NativeFileSystem,
        PreferencesManager      = brackets.getModule("preferences/PreferencesManager"),
        FileIndexManager        = brackets.getModule("project/FileIndexManager"),
        ProjectManager          = brackets.getModule("project/ProjectManager"),
        AppInit                 = brackets.getModule("utils/AppInit"),
        ExtensionUtils          = brackets.getModule("utils/ExtensionUtils"),
        StringUtils             = brackets.getModule("utils/StringUtils"),
        StatusBar               = brackets.getModule("widgets/StatusBar"),
        Strings                 = require("i18n!nls/strings"),
        LanguageKeyEntryTPL     = require("text!htmlContent/language-key-entry.html");
    
    var SHOW_LOCALIZATION_STATUS    = "localizationWorkflow.show";
    
    var lineRegExp      = new RegExp('[^\r\n\f]+', 'g'),
        entryKeyRegExp  = new RegExp('^(\\s*)"([^"]*)'),
        entryDescRegExp = new RegExp('"([^"]*)([^:]*):\\s"([^"]*)');
    
    var $localizationPanel,
        $localizationResults,
        $localeSelector;
    
    var _projectRoot,
        _projectLocalizationFolder,
        _currentRootPath,
        _currentLocale,
        _currentLocalePath;
        
    var rootStrings = {};
    var localeStrings = {};
    
    /**
     * @private
     * @type {PreferenceStorage}
     */
    var _prefs = null;
    
    /**
     * @private
     * @type {PreferenceStorage}
     */
    var _projectPrefs = {};
    
    function _parseStrings(text) {
        var data, strings = {};
        
        var lines = StringUtils.getLines(text),
            matches = 0,
            match;
        
        while ((match = lineRegExp.exec(text)) !== null) {
            if (entryKeyRegExp.test(match)) {
                var lineNum = StringUtils.offsetToLineNum(lines, match.index);

                data = entryDescRegExp.exec(match);
                
                if (data && data[1]) {
                    strings[data[1]] = {desc: data[3],
                                        start: {line: lineNum, ch: 0},
                                        end: {line: lineNum, ch: match[0].length},
                                        descStart: {line: lineNum, ch: match[0].indexOf(data[3])},
                                        descEnd: {line: lineNum, ch: match[0].indexOf(data[3]) + data[3].length}};
                    
                    matches++;
                }
            }
        }
                
        return {entries: strings, length: matches};
    }
    
    function _clickHandler(locale, selStart, selEnd) {
        StatusBar.showBusyIndicator(true);
        CommandManager.execute(Commands.FILE_OPEN, {fullPath: _projectLocalizationFolder + "/" + locale + "/strings.js"})
            .done(function (doc) {
                EditorManager.getCurrentFullEditor().setSelection(selStart, selEnd);
                StatusBar.hideBusyIndicator();
            });
    }
    
    function _ignoreLangEntry(locale, key) {
        _projectPrefs[locale].ignored[key] = true;
        _prefs.setValue(_projectRoot, _projectPrefs);
    }
    
    function _compareLocales() {
        
        var rootEntries         = rootStrings.entries,
            numRootEntries      = rootStrings.length,
            localeEntries       = localeStrings.entries,
            numLocaleEntries    = localeStrings.length,
            numUnusedEntries    = 0,
            key,
            $row;
        
        // Clean results
        $localizationResults.find("tr:gt(0)").remove();
        
        for (key in rootEntries) {
            if (rootEntries.hasOwnProperty(key)) {
                if (localeEntries[key] === undefined) {
                    $row = $(Mustache.render(LanguageKeyEntryTPL, {
                        desc: Strings.MISSING_STRING_DESC,
                        key: key,
                        sellocale: "root",
                        state: "missing"
                    }))
                        .data("selstart", rootEntries[key].start)
                        .data("selend", rootEntries[key].end);
                    
                    $localizationResults.append($row);
                } else {
                    if (localeEntries[key].desc === rootEntries[key].desc) {
                        var ignored = _projectPrefs[_currentLocale].ignored[key];
                        
                        $row = $(Mustache.render(LanguageKeyEntryTPL, {
                            desc: Strings.UNTRANSLATED_STRING_DESC,
                            key: key,
                            sellocale: _currentLocale,
                            state: "untranslated" + (ignored ? " ignored" : "")
                        }))
                            .data("selstart", localeEntries[key].descStart)
                            .data("selend", localeEntries[key].descEnd);
                        
                        $localizationResults.append($row);
                    }
                    delete localeEntries[key];
                }
            }
        }
        
        for (key in localeEntries) {
            if (localeEntries.hasOwnProperty(key)) {
                $row = $(LanguageKeyEntryTPL, Mustache.render({
                    desc: Strings.UNUSED_STRING_DESC,
                    key: key,
                    sellocale: _currentLocale,
                    state: "unused"
                }))
                    .data("selstart", localeEntries[key].start)
                    .data("selend", localeEntries[key].end);
                
                $localizationResults.append($row);
                numUnusedEntries++;
            }
        }
        
        var localizationProgress = Math.floor(100 * (numLocaleEntries - numUnusedEntries) / numRootEntries),
            $localeStatus = $("#locale-status"),
            localizationProgressClass = "good";
        
        if (localizationProgress < 50) {
            localizationProgressClass = "bad";
        } else if (localizationProgress < 75) {
            localizationProgressClass = "warn";
        } else if (localizationProgress < 90) {
            localizationProgressClass = "not-so-good";
        }
        
        $localeStatus.text("(" + localizationProgress + "%)")
            .removeClass()
            .addClass(localizationProgressClass);
    }
    
    function _analyzeLocaleStrings() {
        var fileEntry;
        
        // Do root locale analysis
        fileEntry = new NativeFileSystem.FileEntry(_projectLocalizationFolder + "/root/strings.js");
        FileUtils.readAsText(fileEntry).done(function (text) {
            rootStrings = _parseStrings(text);
            
            // Do initial locale analysis
            fileEntry = new NativeFileSystem.FileEntry(_projectLocalizationFolder + "/" + _currentLocale + "/strings.js");
            FileUtils.readAsText(fileEntry).done(function (text) {
                localeStrings = _parseStrings(text);
                _compareLocales();
            });
        });
    }

    function _scanProjectLocales() {
        
        var scanDeferred = $.Deferred();
        
        $localeSelector.empty();
                
        // Load codes for current existing locales
        NativeFileSystem.requestNativeFileSystem(_projectLocalizationFolder, function (fs) {
            fs.root.createReader().readEntries(function (entries) {

                entries.forEach(function (entry) {
                    if (entry.isDirectory) {
                        var match = entry.name.match(/^([a-z]{2})(-[a-z]{2})?$/);
                        
                        if (match) {
                            var language = entry.name,
                                label = match[1];
                            
                            if (match[2]) {
                                label += match[2].toUpperCase();
                            }
                            
                            var $option = $("<li>")
                                .text(label)
                                .attr("value", language)
                                .appendTo($localeSelector);
                            
                            if (!_projectPrefs[label]) {
                                _projectPrefs[label] = { ignored: {} };
                            }
                        }
                    }
                });
                
                console.log(_projectPrefs);
                $("#locale-selector li").on("click", function (evt) {
                    $("#locale-selector li.selected").removeClass("selected");

                    _currentLocale = $(evt.target).addClass("selected").text();
                    // Do locale analysis
                    var fileEntry = new NativeFileSystem.FileEntry(_projectLocalizationFolder + "/" + _currentLocale + "/strings.js");
                    FileUtils.readAsText(fileEntry).done(function (text) {
                        localeStrings = _parseStrings(text);
                        _compareLocales();
                    });
                });
                
                _currentLocale = $("#locale-selector li").first().addClass("selected").text();
                _currentRootPath = _projectLocalizationFolder + "/root/strings.js";
                _currentLocalePath = _projectLocalizationFolder + "/" + _currentLocale + "/strings.js";
                scanDeferred.resolve();
            });
        });
        
        return scanDeferred.promise();
    }
    
    function _resetLocalization() {
        // Clean results
        $localizationResults.find("tr:gt(0)").remove();
        $localeSelector.empty();
    }
    
    function _searchBaseDir(fileList) {
        var searchFor = "/nls/root/strings.js",
            baseDir,
            filtered;
        
        filtered = fileList.filter(function (item) {
            return (item.fullPath.indexOf(searchFor) === (item.fullPath.length - searchFor.length));
        });
        
        if (filtered.length) {
            baseDir = filtered.reduce(function (a, b) {
                if (!b) { return a; }
                return (a.fullPath.length < b.fullPath.length ? a : b);
            });
            
            baseDir = baseDir.fullPath.replace(searchFor, "/nls");
        }
        
        return baseDir;
    }
    
    function _initializeLocalization() {
        _resetLocalization();
        // we should maybe add an indicator here that something is loading/the extension is busy
        
        FileIndexManager.getFileInfoList("all").done(function (fileList) {
            _projectLocalizationFolder = _searchBaseDir(fileList);
            
            if (_projectLocalizationFolder) {
                _scanProjectLocales().done(function () {
                    if ($localizationPanel.is(":visible")) {
                        _analyzeLocaleStrings();
                    }
                });
            } else {
                // we need a better error handling (in this case: no nls folder was found) - maybe an error message in the Panel
                console.log("Fail");
            }
        });
    }
    
    function _handleToggleLocalizationStatus() {
        
        if (!$localizationPanel.is(":visible")) {
            _analyzeLocaleStrings();
            
            $localizationPanel.show();
            $("#localization-workflow .close").one("click", function () { _handleToggleLocalizationStatus(); });
        
            CommandManager.get(SHOW_LOCALIZATION_STATUS).setChecked(true);
        } else {
            $localizationPanel.hide();
            CommandManager.get(SHOW_LOCALIZATION_STATUS).setChecked(false);
        }
        
        EditorManager.resizeEditor();
    }
    
    CommandManager.register(Strings.SHOW_STATUS_CMD, SHOW_LOCALIZATION_STATUS, _handleToggleLocalizationStatus);

    // Load the CSS styles and initialize the HTML content
    ExtensionUtils.loadStyleSheet(module, "styles.css").done(function () {
        
        _prefs = PreferencesManager.getPreferenceStorage(module);
        
        $('.content').append('<div id="localization-workflow" class="bottom-panel">'
                            + ' <div class="toolbar simple-toolbar-layout">'
                            + '     <div class="title">Localizaton workflow</div>'
                            + '     <span id="locale-status"/>'
                            + '     <ul id="locale-selector" class="nav"/>'
                            + '     <a href="#" class="close">&times;</a>'
                            + ' </div>'
                            + ' <div class="table-container">'
                            + '     <table id="localization-results" class="condensed-table" style="table-layout: fixed; width: 100%">'
                            + '         <tr><th>' + Strings.STRING_HEADER + '</th><th>' + Strings.STATUS_HEADER + '</th></tr>'
                            + '     </table>'
                            + ' </div>'
                            + '</div>');
                
        $localizationPanel      = $("#localization-workflow");
        $localeSelector         = $("#locale-selector");
        $localizationResults    = $("#localization-results");
        
        // as this is also triggered on loading the first project (startup), we should maybe use this instead of htmlReady/appReady
        $(ProjectManager).on("projectOpen", function (event, projectRoot) {
            _projectRoot = projectRoot.fullPath;
            _projectPrefs = _prefs.getValue(_projectRoot) || {};
            _initializeLocalization();
        });
        
        $(DocumentManager).on("documentSaved", function (event, document) {
            if (document.file.fullPath === _currentRootPath || document.file.fullPath === _currentLocalePath) {
                _analyzeLocaleStrings();
            }
        });
        
        $localizationResults.delegate("tr.lang-entry", "click", function (event) {
            var $target     = $(event.target),
                $entry      = $(event.currentTarget),
                locale      = $entry.data("sellocale"),
                key         = $entry.data("key"),
                selstart    = $entry.data("selstart"),
                selend      = $entry.data("selend");
            
            if (!$target.hasClass("btn")) {
                _clickHandler(locale, selstart, selend);
            }
        });
        
        $localizationResults.delegate("tr.lang-entry .btn-ignore", "click", function (event) {
            var $btn        = $(event.currentTarget),
                $entry      = $btn.closest("tr.lang-entry"),
                locale      = $entry.data("sellocale"),
                key         = $entry.data("key");
            
            $entry.addClass("ignored");
            _ignoreLangEntry(locale, key);
        });
        
        // Register command
        var menu = Menus.getMenu(Menus.AppMenuBar.VIEW_MENU);
        menu.addMenuDivider();
        menu.addMenuItem(SHOW_LOCALIZATION_STATUS, "", Menus.LAST);
    });
});