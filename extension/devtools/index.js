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
                    const deletedEventListeners = [];
                    const nodes = new Map();
                    const ctxObject = {};
                    componentObject = {};
                    const componentCounts = {};
                    let node_id = 0;
                    let firstLoadSent = false;
                    const domHistory = [];
                    const listeners = {};
                    const activeDom = [];
                    let rebuildingDom = false;

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
                        componentObject[id] = component;
                        ctxObject[id] = component.$$.ctx;
                        console.log(ctxObject);
                        // parse ctx for messaging purposes
                        const ctx = {};
                        component.$$.ctx.forEach((element, index) => {
                            ctx[index] = parseCtx(element);
                        })
                        // parse out elements of $capture_state
                        const captureStateString = component.$capture_state.toString().slice(8, -2);
                        const captureState = captureStateString.split(',').map(string => string.trim());
                        data = {
                            id,
                            ctx,
                            injectState,
                            tagName,
                            captureState,
                            instance,
                            target: (options.target) ? options.target.nodeName + options.target.id : null
                        }
                        components.push(data);
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

                        // store listener data to be added back to DOM after re-renders
                        listeners[node] = listeners[node] ? listeners[node] : [];
                        listeners[node].push({event, handler});

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
                        
                        listeners[node].forEach((listener, index) => {
                            if (listener.event === event) {
                                listeners[node].splice(index, 1);
                            }
                        })                       

                        deletedEventListeners.push({
                            node: nodeData.id,
                            event: event,
                            component: nodeData.component,
                            id: nodeData.id + event
                        })
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

                    function eventAlert(nodeId, event) {
                        rebuildingDom = false;
                        console.log("nodeId: " + nodeId + " event: " + event)
                        window.postMessage({
                            source: 'panel.js',
                            type: 'event',
                            data: {
                                nodeId,
                                event
                            }
                        });
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
                            const domChange = new CustomEvent('dom-changed', {detail: list});
                            window.document.dispatchEvent(domChange)
                        }
                        else {
                            const rebuild = new CustomEvent('rebuild', {detail: list});
                            window.document.dispatchEvent(rebuild);
                        }
                    });
        
                    // capture initial DOM load as one snapshot
                    window.onload = () => {
                        // make sure that data is being sent
                        if (components.length || insertedNodes.length || deletedNodes.length || addedEventListeners.length || deletedEventListeners.length) {
                            const domNode = document.body;
                            domHistory.push(domNode.cloneNode(true));
                            firstLoadSent = true;
                            window.postMessage({
                                source: 'panel.js',
                                type: 'firstLoad',
                                data: {
                                    components,
                                    insertedNodes,
                                    deletedNodes,
                                    addedEventListeners,
                                    deletedEventListeners
                                }
                            });
                        }

                        // reset arrays
                        components.splice(0, components.length);
                        insertedNodes.splice(0, insertedNodes.length);
                        deletedNodes.splice(0, deletedNodes.length);
                        addedEventListeners.splice(0, addedEventListeners.length);
                        deletedEventListeners.splice(0, deletedEventListeners.length);
                        // start MutationObserver
                        observer.observe(window.document, {attributes: true, childList: true, subtree: true});
                    }   

                    // capture subsequent DOM changes to update snapshots
                    window.document.addEventListener('dom-changed', (e) => {
                        // only send message if something changed in SvelteDOM
                        if (components.length || insertedNodes.length || deletedNodes.length || addedEventListeners.length || deletedEventListeners.length) {
                            const domNode = document.body;
                            domHistory.push(domNode.cloneNode(true));
                            let type;
                            // make sure the first load has already been sent; if not, this is the first load
                            if (!firstLoadSent) {
                                type = "firstLoad";
                                firstLoadSent = true;
                            }
                            else type = "update";
                            
                            // parse the ctxObject for messaging purposes
                            parsedCtx = {};
                            for (let component in ctxObject) {
                                const ctxData = {};
                                ctxObject[component].forEach((element, index) => {
                                    ctxData[index] = parseCtx(element);
                                })
                                parsedCtx[component] = ctxData;
                            }
                            
                            window.postMessage({
                                source: 'panel.js',
                                type,
                                data: {
                                    ctxObject: parsedCtx,
                                    components,
                                    insertedNodes,
                                    deletedNodes,
                                    addedEventListeners,
                                    deletedEventListeners
                                }
                            });
                        }
                        
                        // reset arrays
                        components.splice(0, components.length);
                        insertedNodes.splice(0, insertedNodes.length);
                        deletedNodes.splice(0, deletedNodes.length);
                        addedEventListeners.splice(0, addedEventListeners.length);
                        deletedEventListeners.splice(0, deletedEventListeners.length);
                    });

                    window.document.addEventListener('rebuild', () => {
                        window.postMessage({
                            source: 'panel.js',
                            type: 'rebuild',
                            data: {
                                components,
                                insertedNodes,
                                deletedNodes,
                                addedEventListeners,
                                deletedEventListeners
                            }
                        });
                    })

                    function repaintDom(index) {
                        const newDomDoc = domHistory[index];
                        document.body.parentNode.replaceChild(newDomDoc, document.body);
                    }


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
                            const { index, parent } = event.data;
                            if (index === domHistory.length - 1) {
                                rebuildDom(parent);
                            }
                            else {
                                repaintDom(index);
                            }
                        }
                    })

                    function rebuildDom(parent) {
                        rebuildingDom = true;
                        document.body.replaceChildren();
                        const appConstructor = componentObject[parent].constructor;
                        const app = new appConstructor({
                            target: document.body
                        })
                    }
                    `
                }
            ); 
        })
    }
)