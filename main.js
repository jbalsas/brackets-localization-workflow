/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, brackets, $ */

define(function (require, exports, module) {
    'use strict';
    
    var Commands                = brackets.getModule("command/Commands"),
        CommandManager          = brackets.getModule("command/CommandManager"),
        ProjectManager          = brackets.getModule("project/ProjectManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        DocumentManager         = brackets.getModule("document/DocumentManager"),
        Menus                   = brackets.getModule("command/Menus"),
        ExtensionUtils          = brackets.getModule("utils/ExtensionUtils"),
        StringUtils             = brackets.getModule("utils/StringUtils"),
        FileUtils               = brackets.getModule("file/FileUtils"),
        StatusBar               = brackets.getModule("widgets/StatusBar"),
        NativeFileSystem        = brackets.getModule("file/NativeFileSystem").NativeFileSystem,
        Strings                 = require("i18n!nls/strings");
    
    var SHOW_LOCALIZATION_STATUS    = "localizationWorkflow.show";
    var LOCALIZATION_FOLDER         = "nls";
    
    var lineRegExp      = new RegExp('[^\r\n\f]+', 'g'),
        entryKeyRegExp  = new RegExp('^(\\s*)"([^"]*)'),
        entryDescRegExp = new RegExp('"([^"]*)([^:]*):\\s"([^"]*)');
    
    var $localizationPanel,
        $localizationResults,
        $localeSelector;
    
    var _projectLocalizationFolder,
        _currentRootPath,
        _currentLocale,
        _currentLocalePath;
        
    var rootStrings = {};
    var localeStrings = {};
    
    function _parseStrings(text) {
        var data, strings = {};
        
        var lines = StringUtils.getLines(text);
        var match;
        
        while ((match = lineRegExp.exec(text)) !== null) {
            if (entryKeyRegExp.test(match)) {
                var lineNum = StringUtils.offsetToLineNum(lines, match.index);

                data = entryDescRegExp.exec(match);
                strings[data[1]] = {desc: data[3],
                                    start: {line: lineNum, ch: 0},
                                    end: {line: lineNum, ch: match[0].length},
                                    descStart: {line: lineNum, ch: match[0].indexOf(data[3])},
                                    descEnd: {line: lineNum, ch: match[0].indexOf(data[3]) + data[3].length}};
            }
        }
        
        return strings;
    }
    
    function _compareLocales() {
        
        var key, $row;
        
        // Clean results
        $localizationResults.find("tr:gt(0)").remove();
                    
        var _clickHandler = function (locale, selStart, selEnd) {
            return function () {
                StatusBar.showBusyIndicator(true);
                CommandManager.execute(Commands.FILE_OPEN, {fullPath: _projectLocalizationFolder + "/" + locale + "/strings.js"})
                    .done(function (doc) {
                        EditorManager.getCurrentFullEditor().setSelection(selStart, selEnd);
                        StatusBar.hideBusyIndicator();
                    });
            };
        };
        
        for (key in rootStrings) {
            if (rootStrings.hasOwnProperty(key)) {
                if (localeStrings[key] === undefined) {
                    $row = $("<tr>").append($("<td>").html(key)).append($("<td>").html(Strings.MISSING_STRING_DESC)).addClass("missing");
                    $localizationResults.append($row);
                    $row.on("click", _clickHandler("root", rootStrings[key].start, rootStrings[key].end));
                } else {
                    if (localeStrings[key].desc === rootStrings[key].desc) {
                        $row = $("<tr>").append($("<td>").html(key)).append($("<td>").html(Strings.UNTRANSLATED_STRING_DESC)).addClass("untranslated");
                        $localizationResults.append($row);
                        $row.on("click", _clickHandler(_currentLocale, localeStrings[key].descStart, localeStrings[key].descEnd));
                    }
                    delete localeStrings[key];
                }
            }
        }
        
        for (key in localeStrings) {
            if (localeStrings.hasOwnProperty(key)) {
                $row = $("<tr>").append($("<td>").html(key)).append($("<td>").html(Strings.UNUSED_STRING_DESC)).addClass("unused");
                $localizationResults.append($row);
                $row.on("click", _clickHandler(_currentLocale, localeStrings[key].start, localeStrings[key].end));
            }
        }
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
        NativeFileSystem.requestNativeFileSystem(_projectLocalizationFolder, function (dirEntry) {
            dirEntry.createReader().readEntries(function (entries) {

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
                        }
                    }
                });
                
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
    }
    
    function _initializeLocalization(projectPath) {
        _projectLocalizationFolder = projectPath + LOCALIZATION_FOLDER;
        _resetLocalization();
        _scanProjectLocales().done(function () {
            if ($localizationPanel.is(":visible")) {
                _analyzeLocaleStrings();
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

    // Load de CSS styles and initialize the HTML content
    ExtensionUtils.loadStyleSheet(module, "styles.css").done(function () {
        
        $('.content').append('<div id="localization-workflow" class="bottom-panel">'
                            + ' <div class="toolbar simple-toolbar-layout">'
                            + '     <div class="title">Localizaton workflow</div>'
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
        
        $(ProjectManager).on("projectOpen", function (event, projectRoot) {
            _initializeLocalization(projectRoot.fullPath);
        });
        
        $(DocumentManager).on("documentSaved", function (event, document) {
            if (document.file.fullPath === _currentRootPath || document.file.fullPath === _currentLocalePath) {
                _analyzeLocaleStrings();
            }
        });
        
        _initializeLocalization(ProjectManager.getProjectRoot().fullPath);
        
        // Register command
        var menu = Menus.getMenu(Menus.AppMenuBar.DEBUG_MENU);
        menu.addMenuItem(SHOW_LOCALIZATION_STATUS, "", Menus.AFTER, "menu-view-sidebar");
    });
});