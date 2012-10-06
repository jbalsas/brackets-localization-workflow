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
        strings                 = brackets.getModule("i18n!nls/strings");
    
    var SHOW_LOCALIZATION_STATUS    = "localizationWorkflow.show";
    var LOCALIZATION_FOLDER         = "nls";
    
    var lineRegExp      = new RegExp('[^\r\n\f]+', 'g'),
        entryKeyRegExp  = new RegExp('^(\\s*)"([^"]*)'),
        entryDescRegExp = new RegExp('"([^"]*)([^:]*):\\s"([^"]*)');
    
    var $localizationPanel,
        $localizationResults,
        $localeSelector;
    
    var _projectLocalizationFolder;
        
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
                                    end: {line: lineNum, ch: match[0].length}};
            }
        }
        
        return strings;
    }
    
    function _compareLocales() {
        
        var key, $row;
        
        // Clean results
        $localizationResults.find("tr:gt(0)").remove();
                    
        var _clickHandler = function (locale, entry) {
            return function () {
                StatusBar.showBusyIndicator(true);
                CommandManager.execute(Commands.FILE_OPEN, {fullPath: _projectLocalizationFolder + "/" + locale + "/strings.js"})
                    .done(function (doc) {
                        EditorManager.getCurrentFullEditor().setSelection(entry.start, entry.end);
                        StatusBar.hideBusyIndicator();
                    });
            };
        };
        
        for (key in rootStrings) {
            if (rootStrings.hasOwnProperty(key)) {
                if (localeStrings[key] === undefined) {
                    $row = $("<tr>").append($("<td>").html(key)).append($("<td>").html("The key is missing")).addClass("missing");
                    $localizationResults.append($row);
                    $row.on("click", _clickHandler("root", rootStrings[key]));
                } else {
                    if (localeStrings[key].desc === rootStrings[key].desc) {
                        $row = $("<tr>").append($("<td>").html(key)).append($("<td>").html("The key is not translated")).addClass("untranslated");
                        $localizationResults.append($row);
                        $row.on("click", _clickHandler($localeSelector.val(), localeStrings[key]));
                    }
                    delete localeStrings[key];
                }
            }
        }
        
        for (key in localeStrings) {
            if (localeStrings.hasOwnProperty(key)) {
                $row = $("<tr>").append($("<td>").html(key)).append($("<td>").html("The key is not used anymore")).addClass("unused");
                $localizationResults.append($row);
                $row.on("click", _clickHandler($localeSelector.val(), localeStrings[key]));
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
            fileEntry = new NativeFileSystem.FileEntry(_projectLocalizationFolder + "/" + $localeSelector.val() + "/strings.js");
            FileUtils.readAsText(fileEntry).done(function (text) {
                localeStrings = _parseStrings(text);
                _compareLocales();
            });
        });
  
        $localeSelector.on("change", function () {

            // Do locale analysis
            fileEntry = new NativeFileSystem.FileEntry(_projectLocalizationFolder + "/" + $localeSelector.val() + "/strings.js");
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
                            
                            var $option = $("<option>")
                                .text(label)
                                .attr("value", language)
                                .appendTo($localeSelector);
                        }
                    }
                });
                
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
    
    function _handleShowLocalizationStatus() {
        _analyzeLocaleStrings();
        $localizationPanel.show();
        EditorManager.resizeEditor();
    }
    
    CommandManager.register("Show Localization Status", SHOW_LOCALIZATION_STATUS, _handleShowLocalizationStatus);

    // Load de CSS styles and initialize the HTML content
    ExtensionUtils.loadStyleSheet(module, "styles.css").done(function () {
        
        $('.content').append('<div id="localization-workflow" class="bottom-panel">'
                            + ' <div class="toolbar simple-toolbar-layout">'
                            + '     <div class="title">Localizaton workflow</div>'
                            + '     <select id="locale-selector"/>'
                            + '     <a href="#" class="close">&times;</a>'
                            + ' </div>'
                            + ' <div class="table-container">'
                            + '     <table id="localization-results" class="condensed-table" style="table-layout: fixed; width: 100%">'
                            + '         <tr><th>Key</th><th>Status</th></tr>'
                            + '     </table>'
                            + ' </div>'
                            + '</div>');
                
        $localizationPanel      = $("#localization-workflow");
        $localeSelector         = $("#locale-selector");
        $localizationResults    = $("#localization-results");
        
        $(ProjectManager).on("projectOpen", function (event, projectRoot) {
            _initializeLocalization(projectRoot.fullPath);
        });
        
        _initializeLocalization(ProjectManager.getProjectRoot().fullPath);
        
        // Register command
        var menu = Menus.getMenu(Menus.AppMenuBar.DEBUG_MENU);
        menu.addMenuItem(SHOW_LOCALIZATION_STATUS, "", Menus.AFTER, "menu-view-sidebar");
    });
});