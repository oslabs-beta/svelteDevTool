chrome.devtools.panels.create(
    "Slicer",
    "svelte_logo.png",
    "devtools/panel.html",
    function (panel) {
        panel.onShown.addListener(() => {
            chrome.devtools.inspectedWindow.reload(
                {injectedScript:
                    `
                    const components = [];
                    const deletedNodes = [];
                    const insertedNodes = [];
                    const addedEventListeners = [];
                    const nodes = new Map();
                    const ctxObject = {};
                    const componentCounts = {};
                    let node_id = 0;
                    let firstLoadSent = false;
                    const domHistory = [];
                    const ctxHistory = [];
                    const rebuildingDom = false;

                    function setup(root) {
                        root.addEventListener('SvelteRegisterComponent', svelteRegisterComponent);
                        root.addEventListener('SvelteDOMInsert', svelteDOMInsert);
                        root.addEventListener('SvelteDOMRemove', svelteDOMRemove);
                        root.addEventListener('SvelteDOMAddEventListener', svelteDOMAddEventListener);
                        root.addEventListener('SvelteDOMRemoveEventListener', svelteDOMRemoveEventListener);
                    }
                  
                    function svelteRegisterComponent (e) {                       
                        const { component, tagName, options } = e.detail;
                        // assign sequential instance value
		                let instance = 0;
		                if (componentCounts.hasOwnProperty(tagName)) {
			                instance = ++componentCounts[tagName];
		                }
		                componentCounts[tagName] = instance;
                        const id = tagName + instance;
                                                
                        // get state variables and ctx indices from $inject_state
                        const injectState = {};
                        let string = component.$inject_state.toString();
                        while (string.includes('$$invalidate')) {
                            const varIndexStart = string.indexOf('$$invalidate') + 13;
                            const varIndexEnd = string.indexOf(',', varIndexStart);
                            const varIndex = (string.slice(varIndexStart, varIndexEnd));
                            
                            const varNameStart = varIndexEnd + 1;
                            const varNameEnd = string.indexOf('=', varNameStart);
                            const varName = string.slice(varNameStart, varNameEnd).trim();
                            injectState[varName] = varIndex;
                            string = string.slice(varNameEnd);
                        }

                        ctxObject[id] = {ctx: component.$$.ctx, tagName, instance};
                        
                        // parse ctx for messaging purposes
                        const ctx = {};
                        component.$$.ctx.forEach((element, index) => {
                            ctx[index] = parseCtx(element);
                        })

                        data = {
                            id,
                            ctx,
                            injectState,
                            tagName,
                            instance,
                            target: (options.target) ? options.target.nodeName + options.target.id : null
                        }
                        components.push(data);
                    }

                    function svelteDOMRemove(e) {
                        
                        const { node } = e.detail;
                        const nodeData = nodes.get(node);
                        if (nodeData) {
                            deletedNodes.push({
                                id: nodeData.id,
                                component: nodeData.component
                            })
                        }
                    }

                    function svelteDOMInsert(e) {
                        
                        const { node, target } = e.detail;
                        if (node.__svelte_meta) {
                            let id = nodes.get(node);
                            if (!id) {
                                id = node_id++;
                                componentName = getComponentName(node.__svelte_meta.loc.file)
                                nodes.set(node, {id, componentName});
                            }
                            insertedNodes.push({
                                target: ((nodes.get(target)) ? nodes.get(target).id : target.nodeName + target.id),
                                id,
                                component: componentName, 
                                loc: node.__svelte_meta.loc.char
                            });
                        }
                    }

                    function svelteDOMAddEventListener(e) {
                        const { node, event, handler } = e.detail;
                        const nodeData = nodes.get(node);

                        id = nodeData.id + event;

                        node.addEventListener(event, () => eventAlert(nodeData.id, event));
                            
                        addedEventListeners.push({
                            node: nodeData.id,
                            event,
                            handlerName: e.detail.handler.name,
                            handlerString: e.detail.handler.toString(),
                            component: nodeData.component,
                            id
                        })
                    }

                    function svelteDOMRemoveEventListener(e) {
                        const { node, event } = e.detail;
                        nodeData = nodes.get(node);
                        const id = nodeData.id + event;

                        node.removeEventListener(event, () => eventAlert(nodeData.id, event));                      
                    }

                    function getComponentName(file) {
                        if (file.indexOf('/') === -1) {
                            tagName = file.slice((file.lastIndexOf('\\\\') + 1), -7);
                        }
                        else {
                            tagName = file.slice((file.lastIndexOf('/') + 1), -7);
                        }
                        return tagName;
                    }

                    function parseCtx(element, name = null) {
                        if (typeof element === "function") {
                            return {
                                type: 'function', 
                                name: element.name, 
                                string: element.toString()
                            };
                        }
                        else if (element instanceof Element) {
                            let value = 'DOM Element';
                            if (nodes.has(element)) {
                                value = nodes.get(element);
                            }
                            return {
                                type: 'DOM Element',
                                value
                            }
                        }
                        else if (typeof element === "object") {
                            if (element === null) {
                                return {
                                    type: 'value', 
                                    value: element,
                                    name
                                };
                            }
                            if (element.hasOwnProperty('$$')) {
                                return {
                                    type: 'Svelte Component',
                                    value: '<' + element.constructor.name + '>'
                                }
                            }
                            else {
                                const value = {};
                                for (let i in element) {
                                    value[i] = parseCtx(element[i], i);
                                }
                                return {type: 'value', value, name};
                            }
                        }
                        else {
                            return {
                                type: 'value', 
                                value: element,
                                name
                            };
                        }
                    }

                    function parseCtxObject() {
                        parsedCtx = {};
                        for (let component in ctxObject) {
                            const ctxData = {};
                            ctxObject[component].ctx.forEach((element, index) => {
                                ctxData[index] = parseCtx(element);
                            })
                            parsedCtx[component] = ctxData;
                        }
                        return parsedCtx;
                    }

                    function eventAlert(nodeId, event) {
                        rebuildingDom = false;
                        window.postMessage({
                            source: 'panel.js',
                            type: 'event',
                            data: {
                                nodeId,
                                event
                            }
                        });
                    }

                    function rebuildDom(index, parent, state) {
                        rebuildingDom = true;

                        // store old component counts
                        const componentCountsHistory = JSON.parse(JSON.stringify(componentCounts));

                        // erase dom and build new app
                        const parentNode = document.body.parentNode;
                        parentNode.removeChild(document.body);
                        let body = document.createElement("body");
                        parentNode.appendChild(body);
                        const appConstructor = componentObject[parent].constructor;
                        const app = new appConstructor({
                            target: document.body
                        })

                        for (let component in componentCountsHistory) {
                            const count = componentCountsHistory[component];
                            for (let componentInstance in ctxHistory[index]) {
                                const {tagName, instance } = ctxHistory[index][componentInstance];
                                if (tagName === component && instance > count) {
                                    const oldInstance = tagName + (instance - (count + 1));
                                    const { variables } = state[oldInstance];
                                    for (let variable in variables) {
                                        const { name, ctxIndex, initValue } = variables[variable];
                                        if (ctxIndex && initValue) {
                                            injectState(componentInstance, name, ctxHistory[index][oldInstance].ctx[ctxIndex]);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    function injectState(componentId, key, value) {
                        const component = componentObject[componentId];
                        component.$inject_state({ [key]: value })
                    }

                    function repaintDom(index) {
                        const newDomDoc = domHistory[index];
                        document.body.parentNode.replaceChild(newDomDoc, document.body);
                    }

                    setup(window.document);
                  
                    for (let i = 0; i < window.frames.length; i++) {
                        const frame = window.frames[i]
                        const root = frame.document
                        setup(root)
                    }

                    // observe for changes to the DOM
                    const observer = new MutationObserver( list => {
                        if (!rebuildingDom){
                            const domChange = new CustomEvent('dom-changed');
                            window.document.dispatchEvent(domChange)
                        }
                        else {
                            const rebuild = new CustomEvent('rebuild');
                            window.document.dispatchEvent(rebuild);
                        }
                    });
        
                    // capture initial DOM load as one snapshot
                    window.onload = () => {
                        // make sure that data is being sent
                        if (components.length || insertedNodes.length || deletedNodes.length || addedEventListeners.length) {
                            const domNode = document.body;
                            domHistory.push(domNode.cloneNode(true));
                            ctxHistory.push(JSON.parse(JSON.stringify(ctxObject)));
                            firstLoadSent = true;
                            // parse the ctxObject for messaging purposes
                            
                            window.postMessage({
                                source: 'panel.js',
                                type: 'firstLoad',
                                data: {
                                    ctxObject: parseCtxObject(),
                                    components,
                                    insertedNodes,
                                    deletedNodes,
                                    addedEventListeners,
                                }
                            })
                        }

                        // reset arrays
                        components.splice(0, components.length);
                        insertedNodes.splice(0, insertedNodes.length);
                        deletedNodes.splice(0, deletedNodes.length);
                        addedEventListeners.splice(0, addedEventListeners.length);

                        // start MutationObserver
                        observer.observe(window.document, {attributes: true, childList: true, subtree: true});
                    }   

                    // capture subsequent DOM changes to update snapshots
                    window.document.addEventListener('dom-changed', (e) => {
                        // only send message if something changed in SvelteDOM
                        if (components.length || insertedNodes.length || deletedNodes.length || addedEventListeners.length) {
                            const domNode = document.body;
                            domHistory.push(domNode.cloneNode(true));
                            let type;
                            // make sure the first load has already been sent; if not, this is the first load
                            if (!firstLoadSent) {
                                type = "firstLoad";
                                firstLoadSent = true;
                            }
                            else type = "update";
                            
                            window.postMessage({
                                source: 'panel.js',
                                type,
                                data: {
                                    ctxObject: parseCtxObject(),
                                    components,
                                    insertedNodes,
                                    deletedNodes,
                                    addedEventListeners,
                                }
                            });
                        }
                        
                        // reset arrays
                        components.splice(0, components.length);
                        insertedNodes.splice(0, insertedNodes.length);
                        deletedNodes.splice(0, deletedNodes.length);
                        addedEventListeners.splice(0, addedEventListeners.length);
                    });

                    // listen for devTool requesting state injections 
                    window.addEventListener('message', function () {
                        // Only accept messages from the same frame
                        if (event.source !== window) {
                            return;
                        }
                        
                        // Only accept messages that we know are ours
                        if (typeof event.data !== 'object' || event.data === null ||
                          !event.data.source === 'panel.js') {
                          return;
                        }
                          
                        if (event.data.type === 'rerenderState') {
                            repaintDom(event.data.index);
                        }

                        if (event.data.type === 'jumpState') {
                            const { index, parent, state } = event.data;
                            rebuildDom(index, parent, state);
                        }
                    })
                    `
                }
            ); 
        })
    }
)