/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, brackets, $ */

define(function (require, exports, module) {
    'use strict';
    
    var Commands                = brackets.getModule("command/Commands"),
        CommandManager          = brackets.getModule("command/CommandManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        DocumentManager         = brackets.getModule("document/DocumentManager"),
        Menus                   = brackets.getModule("command/Menus"),
        ExtensionUtils          = brackets.getModule("utils/ExtensionUtils"),
        FileUtils               = brackets.getModule("file/FileUtils"),
        NativeFileSystem        = brackets.getModule("file/NativeFileSystem").NativeFileSystem,
        strings                 = brackets.getModule("i18n!nls/strings");
    
    var SHOW_LOCALIZATION_STATUS = "localizationWorkflow.show";

    var $localizationPanel,
        $localizationResults,
        $localeSelector;
    
    var stringsPath = FileUtils.getNativeBracketsDirectoryPath() + "/nls";
    
    var rootStrings = {};
    var localeStrings = {};
    
    function _parseStrings(text) {
        var data, strings = {};
        
        text.match(/[^\r\n]+/g).forEach(function (line, index) {
            if (/^(\s*)\"([^\"]*)/.test(line)) {
                data = /"([^"]*)([^:]*):\s"([^"]*)/.exec(line);
                strings[data[1]] = {line: index, desc: data[3]};
            }
        });
        
        return strings;
    }
    
    function _compareLocales() {
        
        var key, $row;
        for (key in rootStrings) {
            if (rootStrings.hasOwnProperty(key)) {
                if (localeStrings[key] === undefined) {
                    $row = $("<tr>").append($("<td>").html(key)).append($("<td>").html("The key is missing")).addClass("missing");
                    $localizationResults.append($row);
                } else {
                    if (localeStrings[key] === rootStrings[key]) {
                        $row = $("<tr>").append($("<td>").html(key)).append($("<td>").html("The key is not translated")).addClass("untranslated");
                        $localizationResults.append($row);
                    }
                    delete localeStrings[key];
                }
            }
        }
        
        for (key in localeStrings) {
            if (localeStrings.hasOwnProperty(key)) {
                $row = $("<tr>").append($("<td>").html(key)).append($("<td>").html("The key is not used anymore")).addClass("unused");
                $localizationResults.append($row);
            }
        }
        
        $localizationResults.find('tr').click( function(){
          console.log($(this));
        });
    }
    
    function _handleShowLocalizationStatus() {
        
        var fileEntry;
        
        // Do root locale analysis
        fileEntry = new NativeFileSystem.FileEntry(stringsPath + "/root/strings.js");
        FileUtils.readAsText(fileEntry).done(function (text) {
            rootStrings = _parseStrings(text);
            
            // Do initial locale analysis
            fileEntry = new NativeFileSystem.FileEntry(stringsPath + "/" + $localeSelector.val() + "/strings.js");
            FileUtils.readAsText(fileEntry).done(function (text) {
                localeStrings = _parseStrings(text);
                _compareLocales();
            });
        });
  
        $localeSelector.on("change", function () {
            
            // Clean results
            $localizationResults.find("tr:gt(0)").remove();
            
            // Do locale analysis
            fileEntry = new NativeFileSystem.FileEntry(stringsPath + "/" + $localeSelector.val() + "/strings.js");
            FileUtils.readAsText(fileEntry).done(function (text) {
                localeStrings = _parseStrings(text);
                _compareLocales();
            });
        });

        if (!$localizationPanel.is(":visible")) {
            $localizationPanel.show();
        } else {
            $localizationPanel.hide();
        }
        
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
        
        // Load codes for current existing locales
        NativeFileSystem.requestNativeFileSystem(stringsPath, function (dirEntry) {
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
            });
        });
        
        // Register command
        var menu = Menus.getMenu(Menus.AppMenuBar.DEBUG_MENU);
        menu.addMenuItem(SHOW_LOCALIZATION_STATUS, "", Menus.AFTER, "menu-view-sidebar");
    });
});