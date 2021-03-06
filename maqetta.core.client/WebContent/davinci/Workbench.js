define([
	"./Runtime",
	"./model/Path",
	//"davinci/ui/Panel",
	"./util",
	//"./workbench/_ToolbaredContainer",
	"./workbench/ViewPart",
	"./workbench/EditorContainer",
	"dijit/Dialog",
	"dijit/Toolbar",
	"dijit/ToolbarSeparator",
	"dijit/Menu",
	"dijit/MenuBar",
	"dijit/PopupMenuBarItem",
	"dijit/form/Button",
	"dijit/layout/BorderContainer",
	"dijit/layout/StackContainer",
	"dijit/layout/ContentPane",
	"dijit/layout/TabContainer",
	"system/resource",
	"dojo/i18n!./nls/webContent",
	"./ve/metadata",
	"dojo/_base/Deferred",
	"dojo/_base/declare"
], function(Runtime, Path,  util, ViewPart, EditorContainer, Dialog, Toolbar, ToolbarSeparator, Menu, MenuBar, PopupMenuBarItem,
		Button, BorderContainer, StackContainer, ContentPane, TabContainer, sysResource, webContent, metadata, Deferred, declare) {

// Cheap polyfill to approximate bind(), make Safari happy
Function.prototype.bind = Function.prototype.bind || function(that){ return dojo.hitch(that, this);};

var filename2id = function(fileName) {
	return "editor-" + encodeURIComponent(fileName.replace(/[\/| |\t]/g, "_")).replace(/%/g, ":");
};

var updateMainToolBar = function (change, toolbarID) {
	var toolbar1 = dijit.byId("davinci_toolbar_main");
	if(toolbar1){
		dojo.forEach(toolbar1.getChildren(), function(child){
			if (child.isEnabled) {
				child.set('disabled', !child.isEnabled(change.targetObjectId));
			}
		});
	}
};

var getSelectedResource = function(){
	var selection=Runtime.getSelection();
	if (selection[0]&&selection[0].resource) {
		return selection[0].resource;
	}
};

var initializeWorkbenchState = function(){
	
	if (!Workbench._state || !Workbench._state.hasOwnProperty("editors")) {
		Workbench._state = Runtime.serverJSONRequest({
			url: "cmd/getWorkbenchState",
			handleAs: "json", 
			sync: true
		});
	}
	
	var state = Workbench._state;
	if(state && state.project){
		Workbench.setActiveProject(state.project);
	}
	
	if (state && state.editors){
		state.version = davinci.version;
		
		var project = null;
		var singleProject = Workbench.singleProjectMode();
	
		if(singleProject){
			var p = Workbench.getProject();
			project = new Path(p);
		}
	
		for (var i=0;i<state.editors.length;i++){
			if(singleProject){
				// if running in single user mode, only load editors open for specific projects
				var path = new Path(state.editors[i]);
				if(!path.startsWith(project)) {
					continue;
				}
			}
			
			var resource= sysResource.findResource(state.editors[i]);
			var noSelect=state.editors[i] != state.activeEditor;
			if (resource){
				Workbench.openEditor({
					fileName: resource,
					content: resource.getText(),
					noSelect: noSelect,
					isDirty: resource.isDirty(),
					startup: false
				});
			}
		}
	}
	if (!Workbench._state.hasOwnProperty("editors")) {
		Workbench._state = {
			editors: [], 
			version: davinci.version,
			project: Runtime._DEFAULT_PROJECT
		};
	}
};

var Workbench = {
	activePerspective: "",
	actionScope: [],
	_DEFAULT_PROJECT: "project1",
	
	run: function() {
		Runtime.run();
		Workbench._initKeys();
		Workbench._baseTitle = dojo.doc.title;

		Runtime.subscribe("/davinci/ui/selectionChanged", updateMainToolBar);
		Runtime.subscribe("/davinci/ui/editorSelected", updateMainToolBar);
		Runtime.subscribe("/davinci/resource/resourceChanged", Workbench._resourceChanged);

		Runtime.subscribe("/davinci/states/state/changed",
			function(containerWidget, newState, oldState) {
				var currentEditor = Runtime.currentEditor;
				// ignore updates in theme editor
				if (currentEditor.declaredClass != "davinci.ve.themeEditor.ThemeEditor" /*"davinci.ve.VisualEditor"*/) {
					currentEditor.visualEditor.onContentChange.apply(currentEditor.visualEditor, arguments);
				}
			}
		);
		Runtime.subscribe("/davinci/ui/widgetPropertiesChanges",
			function() {
				var ve = Runtime.currentEditor.visualEditor;
				ve._objectPropertiesChange.apply(ve, arguments);
			}
		);

		// bind overlay widgets to corresponding davinci states. singleton; no need to unsubscribe
		davinci.states.subscribe("/davinci/states/state/changed", function(args){
			var prefix = "_show:", widget, dvWidget, helper,
				thisDijit = Runtime.currentEditor.visualEditor.context.getDijit(),
				widgetUtils = require("davinci/ve/widget");
			if(args.newState && !args.newState.indexOf(prefix)){
				widget = thisDijit.byId(args.newState.substring(6));
//    				widget && widget.show();
				dvWidget = widgetUtils.getWidget(widget.domNode);
				helper = dvWidget.getHelper();
				helper && helper.popup && helper.popup(dvWidget);
			}
			if(args.oldState && !args.oldState.indexOf(prefix)){
				widget = thisDijit.byId(args.oldState.substring(6));
//    				widget && widget.hide();
				dvWidget = widgetUtils.getWidget(widget.domNode);
				helper = dvWidget.getHelper();
				helper && helper.tearDown && helper.tearDown(dvWidget);
			}
		});

		/* NO MORE MAIN TOOLBAR WITH NEW UI
		Workbench._createToolBar('init',dojo.byId('davinci_toolbar_main'));
*/
/*
		var top = new davinci.workbench._ToolbaredContainer({}, "davinci_top");
		dojo.place(dojo.byId("davinci_top_bar"), top.toolbarDiv, "replace");
		top.toolbarNode = dojo.byId("_toolbar_main");
		top.setContent(dijit.byId("mainBody"));
		top.startup();
*/
		metadata.init().then(function(){
			var perspective= Runtime.initialPerspective || "davinci.ui.main";
			Workbench.showPerspective(perspective);
			Workbench._updateTitle();
			initializeWorkbenchState();			
		});
	
		var loading = dojo.query('.loading');
		if (loading[0]){ // remove the loading div
			loading[0].parentNode.removeChild(loading[0]);
		}
		Workbench._lastAutoSave = Date.now();
		setInterval(dojo.hitch(this,"_autoSave"),30000);
	},

	_resourceChanged: function (type,changedResource)
	{
		if (type=='deleted')
		{
			fileName=changedResource.getPath();
			var tab = dijit.byId(filename2id(fileName));
			if (tab && !tab._isClosing)
			{
				var tabContainer = dijit.byId("editors_tabcontainer");
				tabContainer.removeChild(tab);
				tab.destroyRecursive();
			}
		}
	},

	unload: function () {
		Workbench._autoSave();
	},

	_createToolBar: function (targetObjectId,targetDiv,actionSets,context){
		var _toolbarcache = [];
		if (!actionSets) {
		   actionSets = Runtime.getExtensions('davinci.actionSets');
		}
		for (var i = 0, len = actionSets.length; i < len; i++) {
			var actions = actionSets[i].actions;
			for (var k = 0, len2 = actions.length; k < len2; k++) {
				var action = actions[k],
					toolBarPath = action.toolbarPath;
				if (toolBarPath) {
					if (!_toolbarcache[toolBarPath]) {
						_toolbarcache[toolBarPath] = [];
					}
					_toolbarcache[toolBarPath].push(action);
				}
			}
		}
	
		var toolbar1 = new Toolbar({'class':"davinciToolbar"}, targetDiv);   
		var radioGroups={};
		var firstgroup = true;
		for (var value in _toolbarcache) {
			if(!firstgroup){
				var separator = new ToolbarSeparator();
				toolbar1.addChild(separator);
			}else{
				firstgroup = false;
			}
			var children;
				var actions = _toolbarcache[value];
				  for(var p = 0;p<actions.length;p++){
					    var action=actions[p];
			 			var id = action.id;
			 			// dont add dupes
			 	
			 			Workbench._loadActionClass(action);
						var parms={showLabel:false/*, id:(id + "_toolbar")*/};
						if (action.label) {
							parms.label=action.label;
						}
						if (action.iconClass) {
							parms.iconClass=action.iconClass;
						}
						var dojoAction;
						if (action.toggle || action.radioGroup)
						{
							dojoAction = new dijit.form.ToggleButton(parms);
							dojoAction.item = action;
							dojoAction.set('checked', action.initialValue);
							if (action.radioGroup)
							{
								var group=radioGroups[action.radioGroup];
								if (!group) {
									group=radioGroups[action.radioGroup]=[];
								}
								group.push(dojoAction);
								dojoAction.onChange=dojo.hitch(this,"_toggleButton",dojoAction,context,group);
							} else {
								dojoAction.onChange=dojo.hitch(this,"_runAction",action,context);
							}
						} else {
							dojoAction = new Button(parms);
							dojoAction.onClick=dojo.hitch(this,"_runAction",action,context);
						}
						if (action.icon)
						{
							var imageNode = document.createElement('img');
							imageNode.src=action.icon;
							imageNode.height = imageNode.width = 18;
							dojoAction.domNode.appendChild(imageNode);
						}

						toolbar1.addChild(dojoAction);
						if(action.isEnabled && !action.isEnabled(targetObjectId) ){ 
							dojoAction.isEnabled = action.isEnabled;
							dojoAction.set('disabled', true);
						}else{
							dojoAction.set('disabled', false);
						}
				}
		}
		return toolbar1;
	},

	showPerspective: function(perspectiveID) {
		Workbench.activePerspective = perspectiveID;
		Workbench._updateMainMenubar();

		var mainBody = dojo.byId('mainBody');
		if (! mainBody.tabs) {
			mainBody.tabs = [];
		}
		
		/* Large border container for the entire page */
		var mainBodyContainer = dijit.byId('mainBody');

		if (!mainBodyContainer) {
			mainBodyContainer = new BorderContainer({
					gutters: false,
					region: "center",
					design: 'sidebar'
				}, mainBody);
		}
		var perspective = Runtime.getExtension("davinci.perspective",perspectiveID);


		if (!perspective){
			Runtime.handleError(dojo.string.substitute(webContent.perspectiveNotFound,[perspectiveID]));
		}

		perspective=dojo.clone(perspective);	// clone so views aren't added to original definition

		var extensions = Runtime.getExtensions("davinci.perspectiveExtension",
				function (extension) {
					return extension.targetID === perspectiveID;
				});
		dojo.forEach(extensions, function (extension){
//TODO: should check if view is already in perspective			
			dojo.forEach(extension.views, function (view){ perspective.views.push(view);});	
		});
		
		if (!mainBody.editorsStackContainer){
			Workbench.editorsStackContainer=mainBody.editorsStackContainer =
				new StackContainer(
				{
					region:'center',
					id: "editorsStackContainer",
					controllerWidget: "dijit.layout.StackController"
				});
		}
		// FIXME: THIS BYPASSES THE PLUGIN SYSTEM.
		// Hardcoding this for now. Need to work with Phil on how to turn change
		// welcome page logic into something that is defined by ve_plugin.js.
		mainBodyContainer.addChild(mainBody.editorsStackContainer);
		if (!mainBody.editorsWelcomePage){
			Workbench.editorsWelcomePage=mainBody.editorsWelcomePage =
				new ContentPane(
				{
					id: "editorsWelcomePage",
					href: "app/davinci/ve/resources/welcome_to_maqetta.html"
					/*
					content: "<div><span id='welcome_page_new_open_container'/></div>\n"+
						"<div id='welcome_page_content'>\n"+
						"<h1>Welcome to Maqetta!</h1>\n"+
						"<p>You can get started by using the menus at the top/right:</p>\n"+
						"<ul class='welcome_page_bullets'>\n"+
						"<li>Click on <img src='app/davinci/img/help_menu_image.png'/> for tutorials.</li>\n"+
						"<li>Click on <img src='app/davinci/img/new_menu_image.png'/> to start authoring a new file.</li>\n"+
						"<li>Click on <img src='app/davinci/img/open_menu_image.png'/> to open a file or theme editor.</li>\n"+
						"</ul>\n"+
						"</div>\n"
					*/
				});
		}
		mainBody.editorsStackContainer.addChild(mainBody.editorsWelcomePage);
		if (!mainBody.tabs.editors) {
			Workbench.editorTabs=mainBody.tabs.editors =
				new (Workbench.hideEditorTabs ? StackContainer : TabContainer)({
					id: "editors_tabcontainer",
					controllerWidget: "dijit.layout.TabController"
				});
			Workbench.editorTabs.setTitle = function(tab, title){ 
				tab.attr('title', title);
				//this = TabContainer
				this.tablist.pane2button[tab.id].attr('label', title);
			};
			
			dojo.connect(mainBody.tabs.editors, "removeChild", this, Workbench._editorTabClosed);
		}
		mainBody.editorsStackContainer.addChild(mainBody.tabs.editors);
		mainBody.editorsStackContainer.selectChild(mainBody.editorsWelcomePage);
		dojo.connect(dijit.byId("editors_tabcontainer"),"selectChild",function(child){
			if (child.editor) {
				Workbench._switchEditor(child.editor);
			}
		});
		mainBodyContainer.startup();


		// Put the toolbar and the main window in a border container
		var appBorderContainer = dijit.byId('davinci_app');
		if (!appBorderContainer) {
			appBorderContainer = new BorderContainer({       
				design: "headline",
				gutters: false,
				liveSplitters: false
			}, "davinci_app");
			
			var topBarPane = new ContentPane({
					region: "top"                    
			}, "davinci_top_bar");
			
			appBorderContainer.addChild(topBarPane);
			appBorderContainer.addChild(mainBodyContainer);
			appBorderContainer.layout();	
			appBorderContainer.startup();
			Workbench._orginalOnResize = window.onresize;
			window.onresize = Workbench.onResize; //alert("All done");}
			dojo.connect(mainBodyContainer, 'onMouseUp', this, 'onResize');

		}
		
		
		/* close all of the old views */
		for (var position in mainBody.tabs.perspective) {
			var view = mainBody.tabs.perspective[position];
			if(!view) {
				continue;
			}
			dojo.forEach(view.getChildren(), function (child) {
				view.removeChild(child);
				if (position != 'left' && position != 'right') {
					child.destroyRecursive(false);
				}
			});
			view.destroyRecursive(false);
			delete mainBody.tabs.perspective[position];
		}

		dojo.forEach(perspective.views, function(view){
			Workbench.showView(view.viewID, false);
		}, this);

		// kludge to workaround problem where tabs are sometimes cutoff/shifted to the left in Chrome for Mac
		// would be nice if we had a workbench onload event that we could attach this to instead of relying on a timeout
		setTimeout(function(){
			appBorderContainer.resize();
		}, 3000);
	},

	onResize: function(e){

		var target = e.explicitOriginalTarget ? e.explicitOriginalTarget : e.srcElement;
		if (e.type == 'resize' || ( (target.id && (target.id.indexOf('dijit_layout__Splitter_')>-1) || (target.nextSibling && target.nextSibling.id && target.nextSibling.id.indexOf('dijit_layout__Splitter_')>-1))  )  ){
			var ed = davinci && Runtime.currentEditor;
			if (davinci && Runtime.currentEditor && Runtime.currentEditor.onResize) {
				Runtime.currentEditor.onResize();
			}
		}
		if(Workbench._orginalOnResize) {
			Workbench._orginalOnResize();
		}
	},

	updateMenubar: function(node, actionSets) {
		var menuTree = Workbench._createMenuTree(actionSets);

		var menuTop = dijit.byId(node.id);
		if (!menuTop) {
			menuTop = new MenuBar({'class': 'dijitInline'}, node);
		}
		Workbench._addItemsToMenubar(menuTree, menuTop);
	},
	
	_updateMainMenubar: function() {
		 var menuDiv=dojo.byId('davinci_main_menu');
		 if (!menuDiv) {
			 return;  // no menu
		 }
		var menuTree = Workbench._createMenuTree();

	   for (var i=0;i<menuTree.length; i++)
	   {
		   var menuTreeItem=menuTree[i];
		   for (var j=0;j<menuTreeItem.menus.length;j++)
		   {
			   var menu=menuTreeItem.menus[j];
			   var dojoMenu = Workbench._createMenu(menu);
			   menu.id = menu.id.replace(".", "-"); // kludge to work around the fact that '.' is being used for ids, and that's not compatible with CSS
				var widget =  dijit.byId(menu.id + "-dropdown");
				if(!widget) {
					widget = new dijit.form.DropDownButton({
						label: menu.label,
						dropDown: dojoMenu,
						id: menu.id + "-dropdown"
					});
					menuDiv.appendChild(widget.domNode);
				}
			   
		   }
		   
	   }

	},
	 
	_addItemsToMenubar: function(menuTree, menuTop) {

		dojo.forEach(menuTree, function(m) {
			var menus = m.menus,
				menuLen = menus.length;
			if (menuLen) {
				dojo.forEach (menus, function(menu) {
					menu.id = menu.id.replace(/\./g, "-"); // kludge to work around the fact that '.' is being used for ids, and that's not compatible with CSS
					var dojoMenu = Workbench._createMenu(menu),
						widget =  dijit.byId(menu.id + "-dropdown");
					if(!widget) {
						widget = new PopupMenuBarItem({
							label: menu.label,
							popup: dojoMenu,
							id: menu.id + "-dropdown"
						});
					}
					menuTop.addChild(widget);
				}, this);
			}
		}, this);
	},

	getOpenEditor: function (){
		var tabContainer = dijit.byId("editors_tabcontainer");
		if(tabContainer && tabContainer.selectedChildWidget && tabContainer.selectedChildWidget.editor){
			return tabContainer.selectedChildWidget.editor;
		}
		return null;
	},


	getAllOpenEditorIds: function (){
	},
	
	
	showModal: function(content, title, style, callback){
		var myDialog = new Dialog({
			title: title,
			content: content,
			style: style
		});
		var handle = dojo.connect(content, "onClose", content, function(){
			var teardown = true;
			if (callback) {
				teardown = callback();
				if (!teardown) {
					// prevent the dialog from being torn down by temporarily overriding _onSubmit() with a call-once, no-op function
					var oldHandler = myDialog._onSubmit;
					myDialog._onSubmit = function() {
						myDialog._onSubmit = oldHandler;
					};
				}
			}
			if (teardown) {
				dojo.disconnect(handle);
			}
			if (this.cancel) {
				myDialog.hide();
			}
		});
		myDialog.show();
	},
	
	_createMenuTree: function(actionSets,pathsOptional) {
		if (!actionSets)
		{  // only get action sets not associated with part
			actionSets =  Runtime.getExtensions("davinci.actionSets", function (actionSet)
			{
				var associations=Runtime.getExtensions("davinci.actionSetPartAssociations",function (actionSetPartAssociation){
					if (actionSetPartAssociation.targetID==actionSet.id) {
						return true;
					}
				});	
				return associations.length === 0;
			});

		}
		var menuTree = [];
		function findID(m, id) { //ALP: dijit.byId?
			for ( var j = 0, jLen = m.length; j < jLen; j++) {
				for ( var k = 0, kLen = m[j].menus.length; k < kLen; k++) {
					if (id == m[j].menus[k].id) {
						return m[j].menus[k].menus;
					}
				}
			}
		}

		function addItem(item, path,pathsOptional) {
			path = path || "additions";
			path = path.split('/');
			var m = menuTree;
			

			Workbench._loadActionClass(item);
			
			
			var sep = path[path.length - 1];
			if (path.length > 1) {
				for ( var i = 0, len = path.length - 1; i < len; i++) {
					var k = findID(m, path[i]);
					if (k) {
						// Runtime.handleError("menu item not
						// found: "+path);
						m = k;
					}
	
				}
			}
			for ( var i = 0, len = m.length; i < len; i++) {
				if (m[i].id == sep) {
					var menus = m[i].menus;
					menus.push(item);
					if (item.separator) // if menu
					{
						var wasAdditions = false;
						menus = item.menus = [];
						for ( var j = 0; j < item.separator.length; j += 2) {
							var id = item.separator[j];
	
							wasAdditions = id == "additions";
							menus.push( {
								id: id,
								isSeparator: item.separator[j + 1],
								menus: []
							});
						}
						if (!wasAdditions) {
							menus.push({
								id: "additions",
								isSeparator: false,
								menus: []
							});
						}
					}
					return;
				}
			}
			if (pathsOptional) {
				menuTree.push( {
					id: sep,
					isSeparator: false,
					menus: [item]
				});
			}
		}
	
		for ( var actionSetN = 0, len = actionSets.length; actionSetN < len; actionSetN++) {
			var actionSet = actionSets[actionSetN];
			if (actionSet.visible) {
				if (actionSet.menu) {
					for ( var menuN = 0, menuLen = actionSet.menu.length; menuN < menuLen; menuN++) {
						var menu = actionSet.menu[menuN];
						if (menu.__mainMenu) {
							for ( var j = 0; j < menu.separator.length; j += 2) {
								menuTree.push( {
										id: menu.separator[j],
										isSeparator: menu.separator[j + 1],
										menus: []
								});
							}
						} else {
							addItem(menu, menu.path,pathsOptional);
							if (menu.populate instanceof Function)
							{
								var menuItems=menu.populate();
								for (var item in menuItems) {
									addItem(menuItems[item], menuItems[item].menubarPath);
								}
							}
								
						}
					}
				}
			}
		}
		
		for ( var actionSetN = 0, len = actionSets.length; actionSetN < len; actionSetN++) {
			var actionSet = actionSets[actionSetN];
			if (actionSet.visible) {
				for ( var actionN = 0, actionLen = actionSet.actions.length; actionN < actionLen; actionN++) {
					var action = actionSet.actions[actionN];
					if (action.menubarPath) {
						addItem(action, action.menubarPath,pathsOptional);
					}
				}
			}
		}
		return menuTree;
	},

	_loadActionClass: function(item) {
		if (typeof item.action == "string") {
			require([item.action], function(ActionClass){
				item.action = new ActionClass();
				item.action.item = item;
			});
		}
	},

	_createMenu: function(menu, context) {
		var dojoMenu,menus,connectFunction;
		if (menu.menus) {  // creating dropdown
		  dojoMenu = new Menu({parentMenu: menu });
		  menus = menu.menus;
		  connectFunction="onOpen";
//					  this._openMenu(dojoMenu, menus);
//					  return dojoMenu;
		} else {	// creating popup
			dojoMenu = new PopupMenu({});
			menus = menu;
			connectFunction="menuOpened";
		}

		dojoMenu.domNode.style.display = "none";
		dojoMenu.actionContext = context;
		dojo.connect(dojoMenu, connectFunction, this, function(evt){
		   this._openMenu(dojoMenu, menus, evt).focus(); // call focus again, now that we messed with the widget contents
		});
		return dojoMenu;
	},
	/*
	 * running in single project mode or multi project mode
	 */
	singleProjectMode: function() {
		return true;
	},
	
	getProject: function() {
		/*
		var params = davinci.Workbench.queryParams();
		if(params.project) {
			return decodeURI(params.project);
		}
		*/
		return Workbench.getActiveProject() || Workbench._DEFAULT_PROJECT;
	},
	
	
	loadProject: function(projectName) {
		/*
		var params = davinci.Workbench.queryParams();
		params.project = encodeURI(projectName);
		
		
		window.location.href=davinci.Workbench.location() + "?" + dojo.objectToQuery(params);
		*/
		Workbench.setActiveProject(projectName);
		location.reload(true);
	},
	
	location: function(){
		return Runtime.location();
	},
	
	queryParams: function(){
		// reloads the browser with the current project.
		var fullPath = document.location.href;
		var split = fullPath.split("?");
		var searchString = split.length>1? split[1] : "";
		// remove the ? from the front of the query string 
		return dojo.queryToObject(searchString);
	},
	
	_openMenu: function (dojoMenu,menus,evt) {

		if (dojoMenu._widgetCallback) {
		  dojoMenu._widgetCallback(evt);
		}
		dojo.forEach(dojoMenu.getChildren(), function(child){
			dojoMenu.removeChild(child);
			child.destroy();
		});
		dojoMenu.focusedChild = null; // TODO: dijit.Menu bug?  Removing a focused child should probably reset focusedChild for us

		var addSeparator,menuAdded;
		for (var i = 0, len = menus.length; i < len; i++) {
			if (menus[i].menus.length > 0) {
				if (menus[i].isSeparator && i>0) {
					addSeparator=true;
				}
				for ( var menuN = 0, menuLen = menus[i].menus.length; menuN < menuLen; menuN++) {
					if (addSeparator && menuAdded)
					{
						dojoMenu.addChild(new dijit.MenuSeparator({}));
						addSeparator=false;
					}
					menuAdded=true;
					var item = menus[i].menus[menuN];
					if (item.separator) {
						var subMenu = Workbench._createMenu(item);
						var popupParent = new dijit.MenuItem({
							label: item.label,
							popup: subMenu,
							id: subMenu.id + "item"
						});
						popupParent.actionContext=dojoMenu.actionContext;
						dojoMenu.addChild(popupParent);
					} else {
						var enabled=true;
						if(item.isEnabled){
							var resource = getSelectedResource();
							enabled = item.isEnabled(resource);
						}

						var label=item.label;
						if (item.action)
						{
							if (item.action.shouldShow && !item.action.shouldShow(dojoMenu.actionContext)) {
								continue;
							}
							enabled= item.action.isEnabled(dojoMenu.actionContext);
							if (item.action.getName) {
								label=item.action.getName();
							}
						}
						var menuArgs= {
								label: label,
								disabled: !enabled,
								onClick: dojo.hitch(this,"_runAction",item,dojoMenu.actionContext)
							};
						if (item.iconClass) {
							menuArgs.iconClass=item.iconClass;
						}
						var menuItem1 = new dijit.MenuItem(menuArgs);
						dojoMenu.addChild(menuItem1);
					}
				}
			}
		}

		dojoMenu.startup();
		return dojoMenu;
	},
	
	_toggleButton: function(button, context, group, arg) {
		if (!button.checked) {
			return;
		}
		group.forEach(function(item){
			if (item != button) {
				item.set('checked', false);
			}
		});
		Workbench._runAction(button.item,context,button.item.id);
	},

	_runAction: function(item, context, arg) {
		if (item.run) {
			item.run();
		} else if (item.action) {
			item.action.run(context);
		} else if (item.method && context && context[item.method] instanceof Function) {
			context[item.method](arg);
		} else if (item.commandID) {
			Runtime.executeCommand(item.commandID);
		}
	},

	showView: function(viewId, shouldFocus){
	  try {
		var mainBodyContainer = dijit.byId('mainBody'),
			view = Runtime.getExtension("davinci.view", viewId),
			mainBody = dojo.byId('mainBody'),
			perspectiveId = Workbench.activePerspective,
			perspective = Runtime.getExtension("davinci.perspective", perspectiveId),
			position = 'left',
			cp1 = null,
			created = false,
			pxHeight = dijit.byId('mainBody')._borderBox.h - 5;
		
		dojo.some(perspective.views, function(view){
			if(view.viewID ==  viewId){
				position = view.position;
				return true;
			}	
		});
		
		mainBody.tabs = mainBody.tabs || {};				
		mainBody.tabs.perspective = mainBody.tabs.perspective || {};

		if(position == 'right' && !mainBody.tabs.perspective.right){
			mainBodyContainer.addChild(mainBody.tabs.perspective.right = new BorderContainer({'class':'davinciPaletteContainer', style: 'width: 275px;', id:"right_mainBody", region:'right', gutters: false, splitter:true}));
			mainBody.tabs.perspective.right.startup();
		}

		if(position == 'left' && !mainBody.tabs.perspective.left){
			mainBodyContainer.addChild(mainBody.tabs.perspective.left = new BorderContainer({'class':'davinciPaletteContainer', style: 'width: 200px;', id:"left_mainBody", region:'left', gutters: false, splitter:true}));
			mainBody.tabs.perspective.left.startup();
		}

		if (position === 'left' || position === 'right') {
			position += "-top";
		}
		var positionSplit = position;

		if (!mainBody.tabs.perspective[position]) {
			positionSplit = position.split('-');

			var region = positionSplit[0],
				parent = mainBodyContainer,
				clazz = '',
				style = '';
			if (positionSplit[1] && (region == 'left' || region == 'right')) {
				parent = mainBody.tabs.perspective[region];
				region = positionSplit[1];
				if (positionSplit[1] == "top") {
					region = "center";
					clazz = "davinciTopPalette";
				} else {
					style = 'height:35%;';
					clazz = "davinciBottomPalette";
				}
			} else if(region == 'bottom') {
				style = 'height:80px;';
				clazz = "davinciBottomPalette";
			}
			cp1 = mainBody.tabs.perspective[position] = new TabContainer({
				region: region,
				'class': clazz,
				style: style,
				splitter: region != "center",
				controllerWidget: "dijit.layout.TabController"
			});
			parent.addChild(cp1);
		} else {
			cp1 = mainBody.tabs.perspective[position];
		}

		if (dojo.some(cp1.getChildren(), function(child){ return child.id == view.id; })) {
			return;
		}

		var getTab = function(view) {
			var d = new Deferred(),
				tab = dijit.byId(view.id);

			if (tab) {
				d.resolve(tab);
			} else {
				require([view.viewClass], function(viewCtor){
					d.resolve(new (viewCtor || ViewPart)({
						position: positionSplit[1] || positionSplit[0],
						title: view.title,
						id: view.id,
						closable: true,
						view: view
					}));
				});
			}
			return d;
		};

		getTab(view).then(function(tab) {
			cp1.addChild(tab);
//		if(tab.startup){
//			debugger;
//			tab.startup();
//		
//		}
			if(shouldFocus) {
				cp1.selectChild(tab);
			}
		});
	  } catch (ex) {
		  console.error("Error loading view: "+view.id);
		  console.error(ex);
	  }
	},
	
	hideView: function(viewId){
		for (var position in mainBody.tabs.perspective) {
			if(position=='left' || position == 'right'){
				position+='-top';
			}
			if(!mainBody.tabs.perspective[position]){
				continue;
			}
			var children = mainBody.tabs.perspective[position].getChildren();
			var found = false;
			for (var i = 0; i < children.length && !found; i++) {
				if (children[i].id == viewId) {
					mainBody.tabs.perspective[position].removeChild(children[i]);
					children[i].destroyRecursive(false);
				}
			}									
		}
	},

	toggleView: function(viewId) {
		var found = dojo.byId(viewId);
		if(found) {
			Workbench.hideView(viewId);
		} else{
			Workbench.showView(viewId, true);
		}
	},

	openEditor: function (keywordArgs, newHtmlParams) {
		var fileName=keywordArgs.fileName,
			content=keywordArgs.content,
			fileExtension,
			file;
		if (typeof fileName=='string') {
			 fileExtension=fileName.substr(fileName.lastIndexOf('.')+1);
		} else {
			file=fileName;
			fileExtension=fileName.getExtension();
			fileName=fileName.getPath();
		}

		var tab = dijit.byId(filename2id(fileName)),
			tabContainer = dijit.byId("editors_tabcontainer");

		if (tab) {
			// already open
			tabContainer.selectChild(tab);
			var editor=tab.editor;
			if (keywordArgs.startOffset) {
				editor.select(keywordArgs);
			}
			return;
		}
		var editorCreateCallback=keywordArgs.editorCreateCallback;
		
		var editorExtensions=Runtime.getExtensions("davinci.editor", function (extension){
			 if (typeof extension.extensions =="string") {
				 extension.extensions=extension.extensions.split(',');
			 }
			 return dojo.some(extension.extensions, function(e){
				 return e.toLowerCase() == fileExtension.toLowerCase();
			 });
		});

		var editorExtension = editorExtensions[0];
		if (editorExtensions.length>1){
			dojo.some(editorExtensions, function(extension){
				editorExtension = extension;
				return extension.isDefault;
			});
		}

		Workbench._createEditor(editorExtension, fileName, keywordArgs, newHtmlParams).then(function(editor) {
			if(editorCreateCallback){
				editorCreateCallback.call(window, editor);
			}

			if(!keywordArgs.noSelect) {
				 Runtime.currentEditor = editor;
			}			
		});
	},
	
	_createEditor: function(editorExtension, fileName, keywordArgs, newHtmlParams){
		var d = new Deferred();
		var nodeName = fileName.split('/').pop();

		var loading = dojo.query('.loading');
		if (loading[0]){
			loading[0].parentNode.removeChild(loading[0]);
		}

		var editorsStackContainer = dijit.byId('editorsStackContainer'),
			editors_tabcontainer = dijit.byId('editors_tabcontainer');
		if (editorsStackContainer && editors_tabcontainer){
			editorsStackContainer.selectChild(editors_tabcontainer);
		}

		var content = keywordArgs.content,
			tab = dijit.byId(filename2id(fileName)),
			tabContainer = dijit.byId("editors_tabcontainer"),
			tabCreated=false;
		if(!tab){
			tabCreated=true;

			tab = new EditorContainer( {
				title: nodeName,
				id: filename2id(fileName), 
				'class': "EditorContainer",
				closable: true,
				isDirty: keywordArgs.isDirty
			});
		}
		
		if (!editorExtension) {
			editorExtension = {
				editorClass: 'davinci/ui/TextEditor',
				id: 'davinci.ui.TextEditor'
			};
		}

		if (tabCreated) {
			tabContainer.addChild(tab);
		}

		// add loading spinner
		var loadIcon = dojo.query('.dijitTabButtonIcon',tab.controlButton.domNode);
		dojo.addClass(loadIcon[0],'tabButtonLoadingIcon');
		dojo.removeClass(loadIcon[0],'dijitNoIcon');
		
		if (!keywordArgs.noSelect) {
			tabContainer.selectChild(tab);
		}
		tab.setEditor(editorExtension, fileName, content, keywordArgs.fileName, tab.domNode, newHtmlParams).then(function(editor) {
			if (keywordArgs.startLine) {
				tab.editor.select(keywordArgs);
			}
			
			if (!keywordArgs.noSelect)
			{
				util.arrayAddOnce(Workbench._state.editors, fileName);
				Workbench._switchEditor(tab.editor, keywordArgs.startup);
			}

			setTimeout(function(){
				var loadIcon = dojo.query('.dijitTabButtonIcon',tab.controlButton.domNode);
				dojo.removeClass(loadIcon[0],'tabButtonLoadingIcon');
				dojo.addClass(loadIcon[0],'dijitNoIcon');
				tab.resize(); //kludge, forces editor to correct size, delayed to force contents to redraw
			}, 100);
			
			d.resolve(tab.editor);
		});
		
		return d;
	},

	createPopup: function(args) {
		var partID = args.partID, domNode=args.domNode, 
			context=args.context,
			widgetCallback=args.openCallback;
//			
		var actionSetIDs=[];
		var editorExtensions=Runtime.getExtension("davinci.actionSetPartAssociations",
			function (extension) {
			   for (var i=0;i<extension.parts.length;i++) {
				   if (extension.parts[i]==partID) {
					   actionSetIDs.push(extension.targetID);
					   return true;
				   }
			   }
			});
		if (actionSetIDs.length) {
		   var actionSets=Runtime.getExtensions("davinci.actionSets",
				function (extension) {
			   		return actionSetIDs.some(function(setID) { return setID == extension.id; });
				});
		   if (actionSets.length) {
			   var menuTree=Workbench._createMenuTree(actionSets,true);
			   Workbench._initActionsKeys(actionSets, args);
			   var popup=Workbench._createMenu(menuTree,context);
			   if (popup && domNode) {
				   popup.bindDomNode(domNode);
			   }
			   popup._widgetCallback=widgetCallback;
			   return popup;
		   }
		   
		}
	},
	
	_initActionsKeys: function(actionSets, args) {
		var keysDomNode = args.keysDomNode || args.domNode,
			keys = {},
			wasKey;
		dojo.forEach(actionSets, function(actionSet){
			dojo.forEach(actionSet.actions, function(action){
				if (action.keySequence) {
					keys[action.keySequence]=action;
					wasKey=true;
				}
			});
		});
		if (wasKey) {
			var context=args.context;
          dojo.connect(keysDomNode, "onkeydown", function (e){
				var seq = Workbench._keySequence(e),
					actionItem = keys[seq];
				if (actionItem) {
					if (actionItem.action.shouldShow && !actionItem.action.shouldShow(context)) {
						return;
					}
					if (actionItem.action.isEnabled(context)) {
						Workbench._runAction(actionItem,context);
					}
        	  }
          });
		}
	},
	
	_initKeys: function () {
		var keys={all: []};
		var keyExtensions=Runtime.getExtensions("davinci.keyBindings");
		dojo.forEach(keyExtensions, function(keyExt){
			var contextID= keyExt.contextID || "all";
			var keyContext=keys[contextID];
			if (!keyContext) {
			  keyContext=keys[contextID]=[];
			}
			
			keyContext[keyExt.sequence]=keyExt.commandID;
		});

		Workbench.keyBindings=keys;
	},

	handleKey: function (e) {
		if (!Workbench.keyBindings) {
			return;
		}
		var seq=Workbench._keySequence(e);
		var cmd;
		if (Workbench.currentContext && Workbench.keyBindings[Workbench.currentContext]) {
			cmd=Workbench.keyBindings[Workbench.currentContext][seq];
		}
		if (!cmd) {
			cmd=Workbench.keyBindings.all[seq];
		}
		if (cmd) {
			Runtime.executeCommand(cmd);
			return true;
		}
	},
	
	_keySequence: function (e) {
		var seq=[];
		if (window.event) 
		{
			if (window.event.ctrlKey) {
				seq.push("M1");
			}
			if (window.event.shiftKey) {
				seq.push("M2");
			}
			if (window.event.altKey) {
				seq.push("M3");
			}
		}
		else 
		{
			if (e.ctrlKey || (e.modifiers==2) || (e.modifiers==3) || (e.modifiers>5)) {
				seq.push("M1");
			}
			if (e.shiftKey || (e.modifiers>3)) {
				seq.push("M2");
			}
			if(e.modifiers) {
				if (e.altKey || (e.modifiers % 2)) {
					seq.push("M3");
				}
			}
			else {
				if (e.altKey) {
					seq.push("M3");
				}
			}
		}
		
		var letter=String.fromCharCode(e.keyCode);
		if (/[A-Z0-9]/.test(letter)) {
			//letter=e.keyChar;
		} else {
			var keyTable = {
				46: "del",
				114: "f3"
			};

			letter = keyTable[e.keyCode] || "xxxxxxxxxx";
		}
		letter=letter.toUpperCase();
		if (letter==' ') {
			letter="' '";
		}
				
		seq.push(letter);
		return seq.join("+");
	},

	setActionScope: function(scopeID,scope) {
		Workbench.actionScope[scopeID]=scope;
	},
	
	findView: function (viewID) {
		var domNode=dijit.byId(viewID);
		if (domNode) {
			return domNode;
		}
	},

	toggleFullScreen: function() {
		var mainBodyContainer = dijit.byId('mainBody');
		if (mainBodyContainer.origLayout) {
			mainBodyContainer.layout = mainBodyContainer.origLayout;
			delete mainBodyContainer.origLayout;
			//TODO: undo z-index
		} else {
			mainBodyContainer.origLayout = mainBodyContainer.layout;
			mainBodyContainer.layout = function(){
				var gutter = "0";
					centerStyle = mainBodyContainer._center.style;

				dojo.mixin(centerStyle, {
					top: gutter,
					left: gutter,
					right: gutter,
					bottom: gutter,
					zIndex: "500"
				});
/*
				dojo.animateProperty({
					node: mainBodyContainer._right,
					duration: 1000,
					properties: {
						width: {end: 0}
					}
				});

				var anim = dojo.anim(mainBodyContainer._right, {width: 0}, 1000);
				dojo.connect(anim, "onAnimate", function(){
					mainBodyContainer.layout();
				});
*/
			};
		}

		var toggleAllButCenter = function(widget) {
			if (widget.region != "center") {
				dojo.toggleClass(widget.domNode, "dijitHidden");
			}
		};
		dojo.forEach(mainBodyContainer.getChildren(), toggleAllButCenter);
		dojo.forEach(mainBodyContainer._splitters, toggleAllButCenter);
		mainBodyContainer.resize();
		dijit.byNode(mainBodyContainer._center).resize();
	},
	
	_switchEditor: function(newEditor, startup) {
		var oldEditor = Runtime.currentEditor;
		Runtime.currentEditor = newEditor;
		try {
			dojo.publish("/davinci/ui/editorSelected", [{
				editor: newEditor,
				oldEditor: oldEditor
			}]);
		} catch (ex) {console.error(ex);}
		Workbench._updateTitle(newEditor);
		Workbench._state.activeEditor=newEditor ? newEditor.fileName : null;
	
		if(newEditor && newEditor.focus) { newEditor.focus(); }

		setTimeout(function(){
			// kludge: if there is a visualeditor and it is already populated, resize to make Dijit visualEditor contents resize
			// If editor is still starting up, there is code on completion to do a resize
			// seems necessary due to combination of 100%x100% layouts and extraneous width/height measurements serialized in markup
			if (newEditor && newEditor.visualEditor && newEditor.visualEditor.context.isActive()) {
				newEditor.visualEditor.context.getTopWidgets().forEach(function (widget) { if (widget.resize) { widget.resize(); } });
			}
		}, 1000);

		if(!startup) {
			Workbench._updateWorkbenchState();
		}
	},

	_updateTitle: function(currentEditor) {
		var newTitle=Workbench._baseTitle;
		if (currentEditor) {
			newTitle = newTitle + " - ";
			if (currentEditor.isDirty) {
				newTitle=newTitle+"*";
			}
			newTitle=newTitle+currentEditor.fileName;
		}
		dojo.doc.title=newTitle;
	},

	_editorTabClosed: function(page) {
		if (page && page.editor && page.editor.fileName) {
			util.arrayRemove(Workbench._state.editors, page.editor.fileName);
			Workbench._updateWorkbenchState();
		}
		var editors=dijit.byId("editors_tabcontainer").getChildren();
		if (!editors.length) {
			Workbench._switchEditor(null);
			var editorsStackContainer = dijit.byId('editorsStackContainer');
			var editorsWelcomePage = dijit.byId('editorsWelcomePage');
			if (editorsStackContainer && editorsWelcomePage){
				editorsStackContainer.selectChild(editorsWelcomePage);
			}
		}
	},

	getActiveProject: function() {
		if (!Workbench._state) {
			Workbench._state=Runtime.serverJSONRequest({url:"cmd/getWorkbenchState", handleAs:"json", sync:true});
		}
		
		if (Workbench._state.hasOwnProperty("project")) {
			return Workbench._state.project;
		}

		return Workbench._DEFAULT_PROJECT;
	},
	
	setActiveProject: function(project){
		Workbench._state.project = project;
		Workbench._updateWorkbenchState();
	},
	
	/**
	 * Retrieves a custom property from current workbench state
	 * @param {string} propName  Name of custom property
	 * @return {any} propValue  Any JavaScript value.
	 */
	workbenchStateCustomPropGet: function(propName){
		if(typeof propName == 'string'){
			return Workbench._state[propName];
		}
	},
	
	/**
	 * Assign a custom property to current workbench state and persist new workbench state to server
	 * @param {string} propName  Name of custom property
	 * @param {any} propValue  Any JavaScript value. If undefined, then remove given propName from current workbench state.
	 */
	workbenchStateCustomPropSet: function(propName, propValue){
		if(typeof propName == 'string'){
			if(typeof propValue == 'undefined'){
				delete Workbench._state[propName];
			}else{
				Workbench._state[propName] = propValue;
			}
			Workbench._updateWorkbenchState();
		}
	},
	
	_updateWorkbenchState: function()
	{
		dojo.xhrPut({
			url: "./cmd/setWorkbenchState",
			putData: dojo.toJson(Workbench._state),
			handleAs:"text",
			sync:true
		});
	},

	_autoSave: function(){
		var lastSave = Workbench._lastAutoSave;
		function saveDirty(editor){
			if (editor.isReadOnly || !editor.isDirty) {
				return;
			}
			
			var modified = editor.lastModifiedTime;
			if (modified && modified>lastSave){
				try {
					editor.save(true);
				}catch(ex){
					console.error("Error while autosaving file:" + ex);
				}
			}
		}
		
		dojo.forEach(Workbench.editorTabs.getChildren(),	saveDirty);
				
		Workbench._lastAutoSave = Date.now();
	},
	

	_XX_last_member: true	// dummy with no trailing ','
};

var PopupMenu = declare(Menu, {

	menuOpened: function (event) {},
	
	_openMyself: function(event){
		this.menuOpened(event);
		var open;
		try{
			if(this.adjustPosition){
				var offsetPosition=this.adjustPosition(event);
					open = dijit.popup.open;
					dijit.popup.open = function(args){
						args.x += offsetPosition.x;
						args.y += offsetPosition.y;
						open.call(dijit.popup, args);
					};
			}
			this.inherited(arguments);
		}finally{
			if(open){
				dijit.popup.open = open;
			}
		}
	}
});
dojo.setObject("davinci.Workbench", Workbench);
return Workbench;
});