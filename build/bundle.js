var app = (function () {
    'use strict';

    function noop() { }
    function assign(tar, src) {
        // @ts-ignore
        for (const k in src)
            tar[k] = src[k];
        return tar;
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function exclude_internal_props(props) {
        const result = {};
        for (const k in props)
            if (k[0] !== '$')
                result[k] = props[k];
        return result;
    }
    function action_destroyer(action_result) {
        return action_result && is_function(action_result.destroy) ? action_result.destroy : noop;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function svg_element(name) {
        return document.createElementNS('http://www.w3.org/2000/svg', name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function set_attributes(node, attributes) {
        // @ts-ignore
        const descriptors = Object.getOwnPropertyDescriptors(node.__proto__);
        for (const key in attributes) {
            if (attributes[key] == null) {
                node.removeAttribute(key);
            }
            else if (key === 'style') {
                node.style.cssText = attributes[key];
            }
            else if (key === '__value' || descriptors[key] && descriptors[key].set) {
                node[key] = attributes[key];
            }
            else {
                attr(node, key, attributes[key]);
            }
        }
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_data(text, data) {
        data = '' + data;
        if (text.data !== data)
            text.data = data;
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error(`Function called outside component initialization`);
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }
    function onDestroy(fn) {
        get_current_component().$$.on_destroy.push(fn);
    }
    function getContext(key) {
        return get_current_component().$$.context.get(key);
    }
    // TODO figure out if we still want to support
    // shorthand events, or if we want to implement
    // a real bubbling mechanism
    function bubble(component, event) {
        const callbacks = component.$$.callbacks[event.type];
        if (callbacks) {
            callbacks.slice().forEach(fn => fn(event));
        }
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    function add_flush_callback(fn) {
        flush_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }

    function get_spread_update(levels, updates) {
        const update = {};
        const to_null_out = {};
        const accounted_for = { $$scope: 1 };
        let i = levels.length;
        while (i--) {
            const o = levels[i];
            const n = updates[i];
            if (n) {
                for (const key in o) {
                    if (!(key in n))
                        to_null_out[key] = 1;
                }
                for (const key in n) {
                    if (!accounted_for[key]) {
                        update[key] = n[key];
                        accounted_for[key] = 1;
                    }
                }
                levels[i] = n;
            }
            else {
                for (const key in o) {
                    accounted_for[key] = 1;
                }
            }
        }
        for (const key in to_null_out) {
            if (!(key in update))
                update[key] = undefined;
        }
        return update;
    }

    function bind(component, name, callback) {
        const index = component.$$.props[name];
        if (index !== undefined) {
            component.$$.bound[index] = callback;
            callback(component.$$.ctx[index]);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const prop_values = options.props || {};
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, prop_values, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if ($$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(children(options.target));
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set() {
            // overridden by instance, if it has props
        }
    }

    /*! *****************************************************************************
    Copyright (c) Microsoft Corporation. All rights reserved.
    Licensed under the Apache License, Version 2.0 (the "License"); you may not use
    this file except in compliance with the License. You may obtain a copy of the
    License at http://www.apache.org/licenses/LICENSE-2.0

    THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
    KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
    WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
    MERCHANTABLITY OR NON-INFRINGEMENT.

    See the Apache Version 2.0 License for specific language governing permissions
    and limitations under the License.
    ***************************************************************************** */
    /* global Reflect, Promise */

    var extendStatics = function(d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };

    function __extends(d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    }

    var __assign = function() {
        __assign = Object.assign || function __assign(t) {
            for (var s, i = 1, n = arguments.length; i < n; i++) {
                s = arguments[i];
                for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
            }
            return t;
        };
        return __assign.apply(this, arguments);
    };

    function __read(o, n) {
        var m = typeof Symbol === "function" && o[Symbol.iterator];
        if (!m) return o;
        var i = m.call(o), r, ar = [], e;
        try {
            while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
        }
        catch (error) { e = { error: error }; }
        finally {
            try {
                if (r && !r.done && (m = i["return"])) m.call(i);
            }
            finally { if (e) throw e.error; }
        }
        return ar;
    }

    function __spread() {
        for (var ar = [], i = 0; i < arguments.length; i++)
            ar = ar.concat(__read(arguments[i]));
        return ar;
    }

    /**
     * @license
     * Copyright 2016 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCFoundation = /** @class */ (function () {
        function MDCFoundation(adapter) {
            if (adapter === void 0) { adapter = {}; }
            this.adapter_ = adapter;
        }
        Object.defineProperty(MDCFoundation, "cssClasses", {
            get: function () {
                // Classes extending MDCFoundation should implement this method to return an object which exports every
                // CSS class the foundation class needs as a property. e.g. {ACTIVE: 'mdc-component--active'}
                return {};
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCFoundation, "strings", {
            get: function () {
                // Classes extending MDCFoundation should implement this method to return an object which exports all
                // semantic strings as constants. e.g. {ARIA_ROLE: 'tablist'}
                return {};
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCFoundation, "numbers", {
            get: function () {
                // Classes extending MDCFoundation should implement this method to return an object which exports all
                // of its semantic numbers as constants. e.g. {ANIMATION_DELAY_MS: 350}
                return {};
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCFoundation, "defaultAdapter", {
            get: function () {
                // Classes extending MDCFoundation may choose to implement this getter in order to provide a convenient
                // way of viewing the necessary methods of an adapter. In the future, this could also be used for adapter
                // validation.
                return {};
            },
            enumerable: true,
            configurable: true
        });
        MDCFoundation.prototype.init = function () {
            // Subclasses should override this method to perform initialization routines (registering events, etc.)
        };
        MDCFoundation.prototype.destroy = function () {
            // Subclasses should override this method to perform de-initialization routines (de-registering events, etc.)
        };
        return MDCFoundation;
    }());

    /**
     * @license
     * Copyright 2016 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCComponent = /** @class */ (function () {
        function MDCComponent(root, foundation) {
            var args = [];
            for (var _i = 2; _i < arguments.length; _i++) {
                args[_i - 2] = arguments[_i];
            }
            this.root_ = root;
            this.initialize.apply(this, __spread(args));
            // Note that we initialize foundation here and not within the constructor's default param so that
            // this.root_ is defined and can be used within the foundation class.
            this.foundation_ = foundation === undefined ? this.getDefaultFoundation() : foundation;
            this.foundation_.init();
            this.initialSyncWithDOM();
        }
        MDCComponent.attachTo = function (root) {
            // Subclasses which extend MDCBase should provide an attachTo() method that takes a root element and
            // returns an instantiated component with its root set to that element. Also note that in the cases of
            // subclasses, an explicit foundation class will not have to be passed in; it will simply be initialized
            // from getDefaultFoundation().
            return new MDCComponent(root, new MDCFoundation({}));
        };
        /* istanbul ignore next: method param only exists for typing purposes; it does not need to be unit tested */
        MDCComponent.prototype.initialize = function () {
            var _args = [];
            for (var _i = 0; _i < arguments.length; _i++) {
                _args[_i] = arguments[_i];
            }
            // Subclasses can override this to do any additional setup work that would be considered part of a
            // "constructor". Essentially, it is a hook into the parent constructor before the foundation is
            // initialized. Any additional arguments besides root and foundation will be passed in here.
        };
        MDCComponent.prototype.getDefaultFoundation = function () {
            // Subclasses must override this method to return a properly configured foundation class for the
            // component.
            throw new Error('Subclasses must override getDefaultFoundation to return a properly configured ' +
                'foundation class');
        };
        MDCComponent.prototype.initialSyncWithDOM = function () {
            // Subclasses should override this method if they need to perform work to synchronize with a host DOM
            // object. An example of this would be a form control wrapper that needs to synchronize its internal state
            // to some property or attribute of the host DOM. Please note: this is *not* the place to perform DOM
            // reads/writes that would cause layout / paint, as this is called synchronously from within the constructor.
        };
        MDCComponent.prototype.destroy = function () {
            // Subclasses may implement this method to release any resources / deregister any listeners they have
            // attached. An example of this might be deregistering a resize event from the window object.
            this.foundation_.destroy();
        };
        MDCComponent.prototype.listen = function (evtType, handler, options) {
            this.root_.addEventListener(evtType, handler, options);
        };
        MDCComponent.prototype.unlisten = function (evtType, handler, options) {
            this.root_.removeEventListener(evtType, handler, options);
        };
        /**
         * Fires a cross-browser-compatible custom event from the component root of the given type, with the given data.
         */
        MDCComponent.prototype.emit = function (evtType, evtData, shouldBubble) {
            if (shouldBubble === void 0) { shouldBubble = false; }
            var evt;
            if (typeof CustomEvent === 'function') {
                evt = new CustomEvent(evtType, {
                    bubbles: shouldBubble,
                    detail: evtData,
                });
            }
            else {
                evt = document.createEvent('CustomEvent');
                evt.initCustomEvent(evtType, shouldBubble, false, evtData);
            }
            this.root_.dispatchEvent(evt);
        };
        return MDCComponent;
    }());

    /**
     * @license
     * Copyright 2019 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    /**
     * Stores result from applyPassive to avoid redundant processing to detect
     * passive event listener support.
     */
    var supportsPassive_;
    /**
     * Determine whether the current browser supports passive event listeners, and
     * if so, use them.
     */
    function applyPassive(globalObj, forceRefresh) {
        if (globalObj === void 0) { globalObj = window; }
        if (forceRefresh === void 0) { forceRefresh = false; }
        if (supportsPassive_ === undefined || forceRefresh) {
            var isSupported_1 = false;
            try {
                globalObj.document.addEventListener('test', function () { return undefined; }, {
                    get passive() {
                        isSupported_1 = true;
                        return isSupported_1;
                    },
                });
            }
            catch (e) {
            } // tslint:disable-line:no-empty cannot throw error due to tests. tslint also disables console.log.
            supportsPassive_ = isSupported_1;
        }
        return supportsPassive_ ? { passive: true } : false;
    }

    /**
     * @license
     * Copyright 2017 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var cssClasses = {
        ACTIVE: 'mdc-slider--active',
        DISABLED: 'mdc-slider--disabled',
        DISCRETE: 'mdc-slider--discrete',
        FOCUS: 'mdc-slider--focus',
        HAS_TRACK_MARKER: 'mdc-slider--display-markers',
        IN_TRANSIT: 'mdc-slider--in-transit',
        IS_DISCRETE: 'mdc-slider--discrete',
    };
    var strings = {
        ARIA_DISABLED: 'aria-disabled',
        ARIA_VALUEMAX: 'aria-valuemax',
        ARIA_VALUEMIN: 'aria-valuemin',
        ARIA_VALUENOW: 'aria-valuenow',
        CHANGE_EVENT: 'MDCSlider:change',
        INPUT_EVENT: 'MDCSlider:input',
        LAST_TRACK_MARKER_SELECTOR: '.mdc-slider__track-marker:last-child',
        PIN_VALUE_MARKER_SELECTOR: '.mdc-slider__pin-value-marker',
        STEP_DATA_ATTR: 'data-step',
        THUMB_CONTAINER_SELECTOR: '.mdc-slider__thumb-container',
        TRACK_MARKER_CONTAINER_SELECTOR: '.mdc-slider__track-marker-container',
        TRACK_SELECTOR: '.mdc-slider__track',
    };
    var numbers = {
        PAGE_FACTOR: 4,
    };

    /**
     * @license
     * Copyright 2016 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var cssPropertyNameMap = {
        animation: {
            prefixed: '-webkit-animation',
            standard: 'animation',
        },
        transform: {
            prefixed: '-webkit-transform',
            standard: 'transform',
        },
        transition: {
            prefixed: '-webkit-transition',
            standard: 'transition',
        },
    };
    var jsEventTypeMap = {
        animationend: {
            cssProperty: 'animation',
            prefixed: 'webkitAnimationEnd',
            standard: 'animationend',
        },
        animationiteration: {
            cssProperty: 'animation',
            prefixed: 'webkitAnimationIteration',
            standard: 'animationiteration',
        },
        animationstart: {
            cssProperty: 'animation',
            prefixed: 'webkitAnimationStart',
            standard: 'animationstart',
        },
        transitionend: {
            cssProperty: 'transition',
            prefixed: 'webkitTransitionEnd',
            standard: 'transitionend',
        },
    };
    function isWindow(windowObj) {
        return Boolean(windowObj.document) && typeof windowObj.document.createElement === 'function';
    }
    function getCorrectPropertyName(windowObj, cssProperty) {
        if (isWindow(windowObj) && cssProperty in cssPropertyNameMap) {
            var el = windowObj.document.createElement('div');
            var _a = cssPropertyNameMap[cssProperty], standard = _a.standard, prefixed = _a.prefixed;
            var isStandard = standard in el.style;
            return isStandard ? standard : prefixed;
        }
        return cssProperty;
    }
    function getCorrectEventName(windowObj, eventType) {
        if (isWindow(windowObj) && eventType in jsEventTypeMap) {
            var el = windowObj.document.createElement('div');
            var _a = jsEventTypeMap[eventType], standard = _a.standard, prefixed = _a.prefixed, cssProperty = _a.cssProperty;
            var isStandard = cssProperty in el.style;
            return isStandard ? standard : prefixed;
        }
        return eventType;
    }

    /**
     * @license
     * Copyright 2017 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var DOWN_EVENTS = ['mousedown', 'pointerdown', 'touchstart'];
    var UP_EVENTS = ['mouseup', 'pointerup', 'touchend'];
    var MOVE_EVENT_MAP = {
        mousedown: 'mousemove',
        pointerdown: 'pointermove',
        touchstart: 'touchmove',
    };
    var KEY_IDS = {
        ARROW_DOWN: 'ArrowDown',
        ARROW_LEFT: 'ArrowLeft',
        ARROW_RIGHT: 'ArrowRight',
        ARROW_UP: 'ArrowUp',
        END: 'End',
        HOME: 'Home',
        PAGE_DOWN: 'PageDown',
        PAGE_UP: 'PageUp',
    };
    var MDCSliderFoundation = /** @class */ (function (_super) {
        __extends(MDCSliderFoundation, _super);
        function MDCSliderFoundation(adapter) {
            var _this = _super.call(this, __assign({}, MDCSliderFoundation.defaultAdapter, adapter)) || this;
            /**
             * We set this to NaN since we want it to be a number, but we can't use '0' or '-1'
             * because those could be valid tabindices set by the client code.
             */
            _this.savedTabIndex_ = NaN;
            _this.active_ = false;
            _this.inTransit_ = false;
            _this.isDiscrete_ = false;
            _this.hasTrackMarker_ = false;
            _this.handlingThumbTargetEvt_ = false;
            _this.min_ = 0;
            _this.max_ = 100;
            _this.step_ = 0;
            _this.value_ = 0;
            _this.disabled_ = false;
            _this.preventFocusState_ = false;
            _this.thumbContainerPointerHandler_ = function () { return _this.handlingThumbTargetEvt_ = true; };
            _this.interactionStartHandler_ = function (evt) { return _this.handleDown_(evt); };
            _this.keydownHandler_ = function (evt) { return _this.handleKeydown_(evt); };
            _this.focusHandler_ = function () { return _this.handleFocus_(); };
            _this.blurHandler_ = function () { return _this.handleBlur_(); };
            _this.resizeHandler_ = function () { return _this.layout(); };
            return _this;
        }
        Object.defineProperty(MDCSliderFoundation, "cssClasses", {
            get: function () {
                return cssClasses;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSliderFoundation, "strings", {
            get: function () {
                return strings;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSliderFoundation, "numbers", {
            get: function () {
                return numbers;
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSliderFoundation, "defaultAdapter", {
            get: function () {
                // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
                return {
                    hasClass: function () { return false; },
                    addClass: function () { return undefined; },
                    removeClass: function () { return undefined; },
                    getAttribute: function () { return null; },
                    setAttribute: function () { return undefined; },
                    removeAttribute: function () { return undefined; },
                    computeBoundingRect: function () { return ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }); },
                    getTabIndex: function () { return 0; },
                    registerInteractionHandler: function () { return undefined; },
                    deregisterInteractionHandler: function () { return undefined; },
                    registerThumbContainerInteractionHandler: function () { return undefined; },
                    deregisterThumbContainerInteractionHandler: function () { return undefined; },
                    registerBodyInteractionHandler: function () { return undefined; },
                    deregisterBodyInteractionHandler: function () { return undefined; },
                    registerResizeHandler: function () { return undefined; },
                    deregisterResizeHandler: function () { return undefined; },
                    notifyInput: function () { return undefined; },
                    notifyChange: function () { return undefined; },
                    setThumbContainerStyleProperty: function () { return undefined; },
                    setTrackStyleProperty: function () { return undefined; },
                    setMarkerValue: function () { return undefined; },
                    appendTrackMarkers: function () { return undefined; },
                    removeTrackMarkers: function () { return undefined; },
                    setLastTrackMarkersStyleProperty: function () { return undefined; },
                    isRTL: function () { return false; },
                };
                // tslint:enable:object-literal-sort-keys
            },
            enumerable: true,
            configurable: true
        });
        MDCSliderFoundation.prototype.init = function () {
            var _this = this;
            this.isDiscrete_ = this.adapter_.hasClass(cssClasses.IS_DISCRETE);
            this.hasTrackMarker_ = this.adapter_.hasClass(cssClasses.HAS_TRACK_MARKER);
            DOWN_EVENTS.forEach(function (evtName) {
                _this.adapter_.registerInteractionHandler(evtName, _this.interactionStartHandler_);
                _this.adapter_.registerThumbContainerInteractionHandler(evtName, _this.thumbContainerPointerHandler_);
            });
            this.adapter_.registerInteractionHandler('keydown', this.keydownHandler_);
            this.adapter_.registerInteractionHandler('focus', this.focusHandler_);
            this.adapter_.registerInteractionHandler('blur', this.blurHandler_);
            this.adapter_.registerResizeHandler(this.resizeHandler_);
            this.layout();
            // At last step, provide a reasonable default value to discrete slider
            if (this.isDiscrete_ && this.getStep() === 0) {
                this.step_ = 1;
            }
        };
        MDCSliderFoundation.prototype.destroy = function () {
            var _this = this;
            DOWN_EVENTS.forEach(function (evtName) {
                _this.adapter_.deregisterInteractionHandler(evtName, _this.interactionStartHandler_);
                _this.adapter_.deregisterThumbContainerInteractionHandler(evtName, _this.thumbContainerPointerHandler_);
            });
            this.adapter_.deregisterInteractionHandler('keydown', this.keydownHandler_);
            this.adapter_.deregisterInteractionHandler('focus', this.focusHandler_);
            this.adapter_.deregisterInteractionHandler('blur', this.blurHandler_);
            this.adapter_.deregisterResizeHandler(this.resizeHandler_);
        };
        MDCSliderFoundation.prototype.setupTrackMarker = function () {
            if (this.isDiscrete_ && this.hasTrackMarker_ && this.getStep() !== 0) {
                var min = this.getMin();
                var max = this.getMax();
                var step = this.getStep();
                var numMarkers = (max - min) / step;
                // In case distance between max & min is indivisible to step,
                // we place the secondary to last marker proportionally at where thumb
                // could reach and place the last marker at max value
                var indivisible = Math.ceil(numMarkers) !== numMarkers;
                if (indivisible) {
                    numMarkers = Math.ceil(numMarkers);
                }
                this.adapter_.removeTrackMarkers();
                this.adapter_.appendTrackMarkers(numMarkers);
                if (indivisible) {
                    var lastStepRatio = (max - numMarkers * step) / step + 1;
                    this.adapter_.setLastTrackMarkersStyleProperty('flex-grow', String(lastStepRatio));
                }
            }
        };
        MDCSliderFoundation.prototype.layout = function () {
            this.rect_ = this.adapter_.computeBoundingRect();
            this.updateUIForCurrentValue_();
        };
        MDCSliderFoundation.prototype.getValue = function () {
            return this.value_;
        };
        MDCSliderFoundation.prototype.setValue = function (value) {
            this.setValue_(value, false);
        };
        MDCSliderFoundation.prototype.getMax = function () {
            return this.max_;
        };
        MDCSliderFoundation.prototype.setMax = function (max) {
            if (max < this.min_) {
                throw new Error('Cannot set max to be less than the slider\'s minimum value');
            }
            this.max_ = max;
            this.setValue_(this.value_, false, true);
            this.adapter_.setAttribute(strings.ARIA_VALUEMAX, String(this.max_));
            this.setupTrackMarker();
        };
        MDCSliderFoundation.prototype.getMin = function () {
            return this.min_;
        };
        MDCSliderFoundation.prototype.setMin = function (min) {
            if (min > this.max_) {
                throw new Error('Cannot set min to be greater than the slider\'s maximum value');
            }
            this.min_ = min;
            this.setValue_(this.value_, false, true);
            this.adapter_.setAttribute(strings.ARIA_VALUEMIN, String(this.min_));
            this.setupTrackMarker();
        };
        MDCSliderFoundation.prototype.getStep = function () {
            return this.step_;
        };
        MDCSliderFoundation.prototype.setStep = function (step) {
            if (step < 0) {
                throw new Error('Step cannot be set to a negative number');
            }
            if (this.isDiscrete_ && (typeof (step) !== 'number' || step < 1)) {
                step = 1;
            }
            this.step_ = step;
            this.setValue_(this.value_, false, true);
            this.setupTrackMarker();
        };
        MDCSliderFoundation.prototype.isDisabled = function () {
            return this.disabled_;
        };
        MDCSliderFoundation.prototype.setDisabled = function (disabled) {
            this.disabled_ = disabled;
            this.toggleClass_(cssClasses.DISABLED, this.disabled_);
            if (this.disabled_) {
                this.savedTabIndex_ = this.adapter_.getTabIndex();
                this.adapter_.setAttribute(strings.ARIA_DISABLED, 'true');
                this.adapter_.removeAttribute('tabindex');
            }
            else {
                this.adapter_.removeAttribute(strings.ARIA_DISABLED);
                if (!isNaN(this.savedTabIndex_)) {
                    this.adapter_.setAttribute('tabindex', String(this.savedTabIndex_));
                }
            }
        };
        /**
         * Called when the user starts interacting with the slider
         */
        MDCSliderFoundation.prototype.handleDown_ = function (downEvent) {
            var _this = this;
            if (this.disabled_) {
                return;
            }
            this.preventFocusState_ = true;
            this.setInTransit_(!this.handlingThumbTargetEvt_);
            this.handlingThumbTargetEvt_ = false;
            this.setActive_(true);
            var moveHandler = function (moveEvent) {
                _this.handleMove_(moveEvent);
            };
            var moveEventType = MOVE_EVENT_MAP[downEvent.type];
            // Note: upHandler is [de]registered on ALL potential pointer-related release event types, since some browsers
            // do not always fire these consistently in pairs.
            // (See https://github.com/material-components/material-components-web/issues/1192)
            var upHandler = function () {
                _this.handleUp_();
                _this.adapter_.deregisterBodyInteractionHandler(moveEventType, moveHandler);
                UP_EVENTS.forEach(function (evtName) { return _this.adapter_.deregisterBodyInteractionHandler(evtName, upHandler); });
            };
            this.adapter_.registerBodyInteractionHandler(moveEventType, moveHandler);
            UP_EVENTS.forEach(function (evtName) { return _this.adapter_.registerBodyInteractionHandler(evtName, upHandler); });
            this.setValueFromEvt_(downEvent);
        };
        /**
         * Called when the user moves the slider
         */
        MDCSliderFoundation.prototype.handleMove_ = function (evt) {
            evt.preventDefault();
            this.setValueFromEvt_(evt);
        };
        /**
         * Called when the user's interaction with the slider ends
         */
        MDCSliderFoundation.prototype.handleUp_ = function () {
            this.setActive_(false);
            this.adapter_.notifyChange();
        };
        /**
         * Returns the pageX of the event
         */
        MDCSliderFoundation.prototype.getPageX_ = function (evt) {
            if (evt.targetTouches && evt.targetTouches.length > 0) {
                return evt.targetTouches[0].pageX;
            }
            return evt.pageX;
        };
        /**
         * Sets the slider value from an event
         */
        MDCSliderFoundation.prototype.setValueFromEvt_ = function (evt) {
            var pageX = this.getPageX_(evt);
            var value = this.computeValueFromPageX_(pageX);
            this.setValue_(value, true);
        };
        /**
         * Computes the new value from the pageX position
         */
        MDCSliderFoundation.prototype.computeValueFromPageX_ = function (pageX) {
            var _a = this, max = _a.max_, min = _a.min_;
            var xPos = pageX - this.rect_.left;
            var pctComplete = xPos / this.rect_.width;
            if (this.adapter_.isRTL()) {
                pctComplete = 1 - pctComplete;
            }
            // Fit the percentage complete between the range [min,max]
            // by remapping from [0, 1] to [min, min+(max-min)].
            return min + pctComplete * (max - min);
        };
        /**
         * Handles keydown events
         */
        MDCSliderFoundation.prototype.handleKeydown_ = function (evt) {
            var keyId = this.getKeyId_(evt);
            var value = this.getValueForKeyId_(keyId);
            if (isNaN(value)) {
                return;
            }
            // Prevent page from scrolling due to key presses that would normally scroll the page
            evt.preventDefault();
            this.adapter_.addClass(cssClasses.FOCUS);
            this.setValue_(value, true);
            this.adapter_.notifyChange();
        };
        /**
         * Returns the computed name of the event
         */
        MDCSliderFoundation.prototype.getKeyId_ = function (kbdEvt) {
            if (kbdEvt.key === KEY_IDS.ARROW_LEFT || kbdEvt.keyCode === 37) {
                return KEY_IDS.ARROW_LEFT;
            }
            if (kbdEvt.key === KEY_IDS.ARROW_RIGHT || kbdEvt.keyCode === 39) {
                return KEY_IDS.ARROW_RIGHT;
            }
            if (kbdEvt.key === KEY_IDS.ARROW_UP || kbdEvt.keyCode === 38) {
                return KEY_IDS.ARROW_UP;
            }
            if (kbdEvt.key === KEY_IDS.ARROW_DOWN || kbdEvt.keyCode === 40) {
                return KEY_IDS.ARROW_DOWN;
            }
            if (kbdEvt.key === KEY_IDS.HOME || kbdEvt.keyCode === 36) {
                return KEY_IDS.HOME;
            }
            if (kbdEvt.key === KEY_IDS.END || kbdEvt.keyCode === 35) {
                return KEY_IDS.END;
            }
            if (kbdEvt.key === KEY_IDS.PAGE_UP || kbdEvt.keyCode === 33) {
                return KEY_IDS.PAGE_UP;
            }
            if (kbdEvt.key === KEY_IDS.PAGE_DOWN || kbdEvt.keyCode === 34) {
                return KEY_IDS.PAGE_DOWN;
            }
            return '';
        };
        /**
         * Computes the value given a keyboard key ID
         */
        MDCSliderFoundation.prototype.getValueForKeyId_ = function (keyId) {
            var _a = this, max = _a.max_, min = _a.min_, step = _a.step_;
            var delta = step || (max - min) / 100;
            var valueNeedsToBeFlipped = this.adapter_.isRTL() && (keyId === KEY_IDS.ARROW_LEFT || keyId === KEY_IDS.ARROW_RIGHT);
            if (valueNeedsToBeFlipped) {
                delta = -delta;
            }
            switch (keyId) {
                case KEY_IDS.ARROW_LEFT:
                case KEY_IDS.ARROW_DOWN:
                    return this.value_ - delta;
                case KEY_IDS.ARROW_RIGHT:
                case KEY_IDS.ARROW_UP:
                    return this.value_ + delta;
                case KEY_IDS.HOME:
                    return this.min_;
                case KEY_IDS.END:
                    return this.max_;
                case KEY_IDS.PAGE_UP:
                    return this.value_ + delta * numbers.PAGE_FACTOR;
                case KEY_IDS.PAGE_DOWN:
                    return this.value_ - delta * numbers.PAGE_FACTOR;
                default:
                    return NaN;
            }
        };
        MDCSliderFoundation.prototype.handleFocus_ = function () {
            if (this.preventFocusState_) {
                return;
            }
            this.adapter_.addClass(cssClasses.FOCUS);
        };
        MDCSliderFoundation.prototype.handleBlur_ = function () {
            this.preventFocusState_ = false;
            this.adapter_.removeClass(cssClasses.FOCUS);
        };
        /**
         * Sets the value of the slider
         */
        MDCSliderFoundation.prototype.setValue_ = function (value, shouldFireInput, force) {
            if (force === void 0) { force = false; }
            if (value === this.value_ && !force) {
                return;
            }
            var _a = this, min = _a.min_, max = _a.max_;
            var valueSetToBoundary = value === min || value === max;
            if (this.step_ && !valueSetToBoundary) {
                value = this.quantize_(value);
            }
            if (value < min) {
                value = min;
            }
            else if (value > max) {
                value = max;
            }
            this.value_ = value;
            this.adapter_.setAttribute(strings.ARIA_VALUENOW, String(this.value_));
            this.updateUIForCurrentValue_();
            if (shouldFireInput) {
                this.adapter_.notifyInput();
                if (this.isDiscrete_) {
                    this.adapter_.setMarkerValue(value);
                }
            }
        };
        /**
         * Calculates the quantized value
         */
        MDCSliderFoundation.prototype.quantize_ = function (value) {
            var numSteps = Math.round(value / this.step_);
            return numSteps * this.step_;
        };
        MDCSliderFoundation.prototype.updateUIForCurrentValue_ = function () {
            var _this = this;
            var _a = this, max = _a.max_, min = _a.min_, value = _a.value_;
            var pctComplete = (value - min) / (max - min);
            var translatePx = pctComplete * this.rect_.width;
            if (this.adapter_.isRTL()) {
                translatePx = this.rect_.width - translatePx;
            }
            var transformProp = getCorrectPropertyName(window, 'transform');
            var transitionendEvtName = getCorrectEventName(window, 'transitionend');
            if (this.inTransit_) {
                var onTransitionEnd_1 = function () {
                    _this.setInTransit_(false);
                    _this.adapter_.deregisterThumbContainerInteractionHandler(transitionendEvtName, onTransitionEnd_1);
                };
                this.adapter_.registerThumbContainerInteractionHandler(transitionendEvtName, onTransitionEnd_1);
            }
            requestAnimationFrame(function () {
                // NOTE(traviskaufman): It would be nice to use calc() here,
                // but IE cannot handle calcs in transforms correctly.
                // See: https://goo.gl/NC2itk
                // Also note that the -50% offset is used to center the slider thumb.
                _this.adapter_.setThumbContainerStyleProperty(transformProp, "translateX(" + translatePx + "px) translateX(-50%)");
                _this.adapter_.setTrackStyleProperty(transformProp, "scaleX(" + pctComplete + ")");
            });
        };
        /**
         * Toggles the active state of the slider
         */
        MDCSliderFoundation.prototype.setActive_ = function (active) {
            this.active_ = active;
            this.toggleClass_(cssClasses.ACTIVE, this.active_);
        };
        /**
         * Toggles the inTransit state of the slider
         */
        MDCSliderFoundation.prototype.setInTransit_ = function (inTransit) {
            this.inTransit_ = inTransit;
            this.toggleClass_(cssClasses.IN_TRANSIT, this.inTransit_);
        };
        /**
         * Conditionally adds or removes a class based on shouldBePresent
         */
        MDCSliderFoundation.prototype.toggleClass_ = function (className, shouldBePresent) {
            if (shouldBePresent) {
                this.adapter_.addClass(className);
            }
            else {
                this.adapter_.removeClass(className);
            }
        };
        return MDCSliderFoundation;
    }(MDCFoundation));

    /**
     * @license
     * Copyright 2017 Google Inc.
     *
     * Permission is hereby granted, free of charge, to any person obtaining a copy
     * of this software and associated documentation files (the "Software"), to deal
     * in the Software without restriction, including without limitation the rights
     * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     * copies of the Software, and to permit persons to whom the Software is
     * furnished to do so, subject to the following conditions:
     *
     * The above copyright notice and this permission notice shall be included in
     * all copies or substantial portions of the Software.
     *
     * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
     * THE SOFTWARE.
     */
    var MDCSlider = /** @class */ (function (_super) {
        __extends(MDCSlider, _super);
        function MDCSlider() {
            return _super !== null && _super.apply(this, arguments) || this;
        }
        MDCSlider.attachTo = function (root) {
            return new MDCSlider(root);
        };
        Object.defineProperty(MDCSlider.prototype, "value", {
            get: function () {
                return this.foundation_.getValue();
            },
            set: function (value) {
                this.foundation_.setValue(value);
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSlider.prototype, "min", {
            get: function () {
                return this.foundation_.getMin();
            },
            set: function (min) {
                this.foundation_.setMin(min);
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSlider.prototype, "max", {
            get: function () {
                return this.foundation_.getMax();
            },
            set: function (max) {
                this.foundation_.setMax(max);
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSlider.prototype, "step", {
            get: function () {
                return this.foundation_.getStep();
            },
            set: function (step) {
                this.foundation_.setStep(step);
            },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(MDCSlider.prototype, "disabled", {
            get: function () {
                return this.foundation_.isDisabled();
            },
            set: function (disabled) {
                this.foundation_.setDisabled(disabled);
            },
            enumerable: true,
            configurable: true
        });
        MDCSlider.prototype.initialize = function () {
            this.thumbContainer_ = this.root_.querySelector(strings.THUMB_CONTAINER_SELECTOR);
            this.track_ = this.root_.querySelector(strings.TRACK_SELECTOR);
            this.pinValueMarker_ = this.root_.querySelector(strings.PIN_VALUE_MARKER_SELECTOR);
            this.trackMarkerContainer_ = this.root_.querySelector(strings.TRACK_MARKER_CONTAINER_SELECTOR);
        };
        MDCSlider.prototype.getDefaultFoundation = function () {
            var _this = this;
            // DO NOT INLINE this variable. For backward compatibility, foundations take a Partial<MDCFooAdapter>.
            // To ensure we don't accidentally omit any methods, we need a separate, strongly typed adapter variable.
            // tslint:disable:object-literal-sort-keys Methods should be in the same order as the adapter interface.
            var adapter = {
                hasClass: function (className) { return _this.root_.classList.contains(className); },
                addClass: function (className) { return _this.root_.classList.add(className); },
                removeClass: function (className) { return _this.root_.classList.remove(className); },
                getAttribute: function (name) { return _this.root_.getAttribute(name); },
                setAttribute: function (name, value) { return _this.root_.setAttribute(name, value); },
                removeAttribute: function (name) { return _this.root_.removeAttribute(name); },
                computeBoundingRect: function () { return _this.root_.getBoundingClientRect(); },
                getTabIndex: function () { return _this.root_.tabIndex; },
                registerInteractionHandler: function (evtType, handler) { return _this.listen(evtType, handler, applyPassive()); },
                deregisterInteractionHandler: function (evtType, handler) { return _this.unlisten(evtType, handler, applyPassive()); },
                registerThumbContainerInteractionHandler: function (evtType, handler) {
                    _this.thumbContainer_.addEventListener(evtType, handler, applyPassive());
                },
                deregisterThumbContainerInteractionHandler: function (evtType, handler) {
                    _this.thumbContainer_.removeEventListener(evtType, handler, applyPassive());
                },
                registerBodyInteractionHandler: function (evtType, handler) { return document.body.addEventListener(evtType, handler); },
                deregisterBodyInteractionHandler: function (evtType, handler) { return document.body.removeEventListener(evtType, handler); },
                registerResizeHandler: function (handler) { return window.addEventListener('resize', handler); },
                deregisterResizeHandler: function (handler) { return window.removeEventListener('resize', handler); },
                notifyInput: function () { return _this.emit(strings.INPUT_EVENT, _this); },
                notifyChange: function () { return _this.emit(strings.CHANGE_EVENT, _this); },
                setThumbContainerStyleProperty: function (propertyName, value) {
                    _this.thumbContainer_.style.setProperty(propertyName, value);
                },
                setTrackStyleProperty: function (propertyName, value) { return _this.track_.style.setProperty(propertyName, value); },
                setMarkerValue: function (value) { return _this.pinValueMarker_.innerText = value.toLocaleString(); },
                appendTrackMarkers: function (numMarkers) {
                    var frag = document.createDocumentFragment();
                    for (var i = 0; i < numMarkers; i++) {
                        var marker = document.createElement('div');
                        marker.classList.add('mdc-slider__track-marker');
                        frag.appendChild(marker);
                    }
                    _this.trackMarkerContainer_.appendChild(frag);
                },
                removeTrackMarkers: function () {
                    while (_this.trackMarkerContainer_.firstChild) {
                        _this.trackMarkerContainer_.removeChild(_this.trackMarkerContainer_.firstChild);
                    }
                },
                setLastTrackMarkersStyleProperty: function (propertyName, value) {
                    // We remove and append new nodes, thus, the last track marker must be dynamically found.
                    var lastTrackMarker = _this.root_.querySelector(strings.LAST_TRACK_MARKER_SELECTOR);
                    lastTrackMarker.style.setProperty(propertyName, value);
                },
                isRTL: function () { return getComputedStyle(_this.root_).direction === 'rtl'; },
            };
            // tslint:enable:object-literal-sort-keys
            return new MDCSliderFoundation(adapter);
        };
        MDCSlider.prototype.initialSyncWithDOM = function () {
            var origValueNow = this.parseFloat_(this.root_.getAttribute(strings.ARIA_VALUENOW), this.value);
            var min = this.parseFloat_(this.root_.getAttribute(strings.ARIA_VALUEMIN), this.min);
            var max = this.parseFloat_(this.root_.getAttribute(strings.ARIA_VALUEMAX), this.max);
            // min and max need to be set in the right order to avoid throwing an error
            // when the new min is greater than the default max.
            if (min >= this.max) {
                this.max = max;
                this.min = min;
            }
            else {
                this.min = min;
                this.max = max;
            }
            this.step = this.parseFloat_(this.root_.getAttribute(strings.STEP_DATA_ATTR), this.step);
            this.value = origValueNow;
            this.disabled = (this.root_.hasAttribute(strings.ARIA_DISABLED) &&
                this.root_.getAttribute(strings.ARIA_DISABLED) !== 'false');
            this.foundation_.setupTrackMarker();
        };
        MDCSlider.prototype.layout = function () {
            this.foundation_.layout();
        };
        MDCSlider.prototype.stepUp = function (amount) {
            if (amount === void 0) { amount = (this.step || 1); }
            this.value += amount;
        };
        MDCSlider.prototype.stepDown = function (amount) {
            if (amount === void 0) { amount = (this.step || 1); }
            this.value -= amount;
        };
        MDCSlider.prototype.parseFloat_ = function (str, defaultValue) {
            var num = parseFloat(str); // tslint:disable-line:ban
            var isNumeric = typeof num === 'number' && isFinite(num);
            return isNumeric ? num : defaultValue;
        };
        return MDCSlider;
    }(MDCComponent));

    function forwardEventsBuilder(component, additionalEvents = []) {
      const events = [
        'focus', 'blur',
        'fullscreenchange', 'fullscreenerror', 'scroll',
        'cut', 'copy', 'paste',
        'keydown', 'keypress', 'keyup',
        'auxclick', 'click', 'contextmenu', 'dblclick', 'mousedown', 'mouseenter', 'mouseleave', 'mousemove', 'mouseover', 'mouseout', 'mouseup', 'pointerlockchange', 'pointerlockerror', 'select', 'wheel',
        'drag', 'dragend', 'dragenter', 'dragstart', 'dragleave', 'dragover', 'drop',
        'touchcancel', 'touchend', 'touchmove', 'touchstart',
        'pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerout', 'pointerleave', 'gotpointercapture', 'lostpointercapture',
        ...additionalEvents
      ];

      function forward(e) {
        bubble(component, e);
      }

      return node => {
        const destructors = [];

        for (let i = 0; i < events.length; i++) {
          destructors.push(listen(node, events[i], forward));
        }

        return {
          destroy: () => {
            for (let i = 0; i < destructors.length; i++) {
              destructors[i]();
            }
          }
        }
      };
    }

    function exclude(obj, keys) {
      let names = Object.getOwnPropertyNames(obj);
      const newObj = {};

      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const cashIndex = name.indexOf('$');
        if (cashIndex !== -1 && keys.indexOf(name.substring(0, cashIndex + 1)) !== -1) {
          continue;
        }
        if (keys.indexOf(name) !== -1) {
          continue;
        }
        newObj[name] = obj[name];
      }

      return newObj;
    }

    function useActions(node, actions) {
      let objects = [];

      if (actions) {
        for (let i = 0; i < actions.length; i++) {
          const isArray = Array.isArray(actions[i]);
          const action = isArray ? actions[i][0] : actions[i];
          if (isArray && actions[i].length > 1) {
            objects.push(action(node, actions[i][1]));
          } else {
            objects.push(action(node));
          }
        }
      }

      return {
        update(actions) {
          if ((actions && actions.length || 0) != objects.length) {
            throw new Error('You must not change the length of an actions array.');
          }

          if (actions) {
            for (let i = 0; i < actions.length; i++) {
              if (objects[i] && 'update' in objects[i]) {
                const isArray = Array.isArray(actions[i]);
                if (isArray && actions[i].length > 1) {
                  objects[i].update(actions[i][1]);
                } else {
                  objects[i].update();
                }
              }
            }
          }
        },

        destroy() {
          for (let i = 0; i < objects.length; i++) {
            if (objects[i] && 'destroy' in objects[i]) {
              objects[i].destroy();
            }
          }
        }
      }
    }

    /* node_modules/@smui/slider/Slider.svelte generated by Svelte v3.19.2 */

    function create_if_block_1(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			attr(div, "class", "mdc-slider__track-marker-container");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (29:4) {#if discrete}
    function create_if_block(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			div.innerHTML = `<span class="mdc-slider__pin-value-marker"></span>`;
    			attr(div, "class", "mdc-slider__pin");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div4;
    	let div1;
    	let div0;
    	let t0;
    	let t1;
    	let div3;
    	let t2;
    	let svg;
    	let circle;
    	let t3;
    	let div2;
    	let useActions_action;
    	let forwardEvents_action;
    	let dispose;
    	let if_block0 = /*discrete*/ ctx[4] && /*displayMarkers*/ ctx[5] && create_if_block_1();
    	let if_block1 = /*discrete*/ ctx[4] && create_if_block();

    	let div4_levels = [
    		{
    			class: "\n    mdc-slider\n    " + /*className*/ ctx[2] + "\n    " + (/*discrete*/ ctx[4] ? "mdc-slider--discrete" : "") + "\n    " + (/*discrete*/ ctx[4] && /*displayMarkers*/ ctx[5]
    			? "mdc-slider--display-markers"
    			: "") + "\n  "
    		},
    		{ role: "slider" },
    		{
    			"aria-disabled": /*disabled*/ ctx[3] ? "true" : "false"
    		},
    		{ "aria-valuemin": /*min*/ ctx[6] },
    		{ "aria-valuemax": /*max*/ ctx[7] },
    		{ "aria-valuenow": /*value*/ ctx[0] },
    		/*step*/ ctx[8] === 0
    		? {}
    		: { "data-step": /*step*/ ctx[8] },
    		{ tabindex: /*tabindex*/ ctx[9] },
    		/*inputProps*/ ctx[12],
    		exclude(/*$$props*/ ctx[14], [
    			"use",
    			"class",
    			"disabled",
    			"discrete",
    			"displayMarkers",
    			"min",
    			"max",
    			"step",
    			"value",
    			"tabindex"
    		])
    	];

    	let div4_data = {};

    	for (let i = 0; i < div4_levels.length; i += 1) {
    		div4_data = assign(div4_data, div4_levels[i]);
    	}

    	return {
    		c() {
    			div4 = element("div");
    			div1 = element("div");
    			div0 = element("div");
    			t0 = space();
    			if (if_block0) if_block0.c();
    			t1 = space();
    			div3 = element("div");
    			if (if_block1) if_block1.c();
    			t2 = space();
    			svg = svg_element("svg");
    			circle = svg_element("circle");
    			t3 = space();
    			div2 = element("div");
    			attr(div0, "class", "mdc-slider__track");
    			attr(div1, "class", "mdc-slider__track-container");
    			attr(circle, "cx", "10.5");
    			attr(circle, "cy", "10.5");
    			attr(circle, "r", "7.875");
    			attr(svg, "class", "mdc-slider__thumb");
    			attr(svg, "width", "21");
    			attr(svg, "height", "21");
    			attr(div2, "class", "mdc-slider__focus-ring");
    			attr(div3, "class", "mdc-slider__thumb-container");
    			set_attributes(div4, div4_data);
    		},
    		m(target, anchor) {
    			insert(target, div4, anchor);
    			append(div4, div1);
    			append(div1, div0);
    			append(div1, t0);
    			if (if_block0) if_block0.m(div1, null);
    			append(div4, t1);
    			append(div4, div3);
    			if (if_block1) if_block1.m(div3, null);
    			append(div3, t2);
    			append(div3, svg);
    			append(svg, circle);
    			append(div3, t3);
    			append(div3, div2);
    			/*div4_binding*/ ctx[23](div4);

    			dispose = [
    				action_destroyer(useActions_action = useActions.call(null, div4, /*use*/ ctx[1])),
    				action_destroyer(forwardEvents_action = /*forwardEvents*/ ctx[11].call(null, div4)),
    				listen(div4, "MDCSlider:input", /*handleChange*/ ctx[13])
    			];
    		},
    		p(ctx, [dirty]) {
    			if (/*discrete*/ ctx[4] && /*displayMarkers*/ ctx[5]) {
    				if (!if_block0) {
    					if_block0 = create_if_block_1();
    					if_block0.c();
    					if_block0.m(div1, null);
    				}
    			} else if (if_block0) {
    				if_block0.d(1);
    				if_block0 = null;
    			}

    			if (/*discrete*/ ctx[4]) {
    				if (!if_block1) {
    					if_block1 = create_if_block();
    					if_block1.c();
    					if_block1.m(div3, t2);
    				}
    			} else if (if_block1) {
    				if_block1.d(1);
    				if_block1 = null;
    			}

    			set_attributes(div4, get_spread_update(div4_levels, [
    				dirty & /*className, discrete, displayMarkers*/ 52 && {
    					class: "\n    mdc-slider\n    " + /*className*/ ctx[2] + "\n    " + (/*discrete*/ ctx[4] ? "mdc-slider--discrete" : "") + "\n    " + (/*discrete*/ ctx[4] && /*displayMarkers*/ ctx[5]
    					? "mdc-slider--display-markers"
    					: "") + "\n  "
    				},
    				{ role: "slider" },
    				dirty & /*disabled*/ 8 && {
    					"aria-disabled": /*disabled*/ ctx[3] ? "true" : "false"
    				},
    				dirty & /*min*/ 64 && { "aria-valuemin": /*min*/ ctx[6] },
    				dirty & /*max*/ 128 && { "aria-valuemax": /*max*/ ctx[7] },
    				dirty & /*value*/ 1 && { "aria-valuenow": /*value*/ ctx[0] },
    				dirty & /*step*/ 256 && (/*step*/ ctx[8] === 0
    				? {}
    				: { "data-step": /*step*/ ctx[8] }),
    				dirty & /*tabindex*/ 512 && { tabindex: /*tabindex*/ ctx[9] },
    				dirty & /*inputProps*/ 4096 && /*inputProps*/ ctx[12],
    				dirty & /*exclude, $$props*/ 16384 && exclude(/*$$props*/ ctx[14], [
    					"use",
    					"class",
    					"disabled",
    					"discrete",
    					"displayMarkers",
    					"min",
    					"max",
    					"step",
    					"value",
    					"tabindex"
    				])
    			]));

    			if (useActions_action && is_function(useActions_action.update) && dirty & /*use*/ 2) useActions_action.update.call(null, /*use*/ ctx[1]);
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div4);
    			if (if_block0) if_block0.d();
    			if (if_block1) if_block1.d();
    			/*div4_binding*/ ctx[23](null);
    			run_all(dispose);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	const forwardEvents = forwardEventsBuilder(current_component, ["MDCSlider:input", "MDCSlider:change"]);
    	let { use = [] } = $$props;
    	let { class: className = "" } = $$props;
    	let { disabled = false } = $$props;
    	let { discrete = false } = $$props;
    	let { displayMarkers = false } = $$props;
    	let { min = 0 } = $$props;
    	let { max = 100 } = $$props;
    	let { step = 0 } = $$props;
    	let { value = null } = $$props;
    	let { tabindex = "0" } = $$props;
    	let element;
    	let slider;
    	let formField = getContext("SMUI:form-field");
    	let inputProps = getContext("SMUI:generic:input:props") || {};
    	let addLayoutListener = getContext("SMUI:addLayoutListener");
    	let removeLayoutListener;

    	if (addLayoutListener) {
    		removeLayoutListener = addLayoutListener(layout);
    	}

    	onMount(() => {
    		$$invalidate(19, slider = new MDCSlider(element));

    		if (formField && formField()) {
    			formField().input = slider;
    		}
    	});

    	onDestroy(() => {
    		slider && slider.destroy();

    		if (removeLayoutListener) {
    			removeLayoutListener();
    		}
    	});

    	function handleChange() {
    		$$invalidate(0, value = slider.value);
    	}

    	function layout(...args) {
    		return slider.layout(...args);
    	}

    	function stepUp(amount = 1, ...args) {
    		return slider.stepUp(amount, ...args);
    	}

    	function stepDown(amount = 1, ...args) {
    		return slider.stepDown(amount, ...args);
    	}

    	function getId() {
    		return inputProps && inputProps.id;
    	}

    	function div4_binding($$value) {
    		binding_callbacks[$$value ? "unshift" : "push"](() => {
    			$$invalidate(10, element = $$value);
    		});
    	}

    	$$self.$set = $$new_props => {
    		$$invalidate(14, $$props = assign(assign({}, $$props), exclude_internal_props($$new_props)));
    		if ("use" in $$new_props) $$invalidate(1, use = $$new_props.use);
    		if ("class" in $$new_props) $$invalidate(2, className = $$new_props.class);
    		if ("disabled" in $$new_props) $$invalidate(3, disabled = $$new_props.disabled);
    		if ("discrete" in $$new_props) $$invalidate(4, discrete = $$new_props.discrete);
    		if ("displayMarkers" in $$new_props) $$invalidate(5, displayMarkers = $$new_props.displayMarkers);
    		if ("min" in $$new_props) $$invalidate(6, min = $$new_props.min);
    		if ("max" in $$new_props) $$invalidate(7, max = $$new_props.max);
    		if ("step" in $$new_props) $$invalidate(8, step = $$new_props.step);
    		if ("value" in $$new_props) $$invalidate(0, value = $$new_props.value);
    		if ("tabindex" in $$new_props) $$invalidate(9, tabindex = $$new_props.tabindex);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*slider, disabled*/ 524296) {
    			 if (slider && slider.disabled !== disabled) {
    				$$invalidate(19, slider.disabled = disabled, slider);
    			}
    		}

    		if ($$self.$$.dirty & /*slider, min*/ 524352) {
    			 if (slider && slider.min !== min) {
    				$$invalidate(19, slider.min = min, slider);
    			}
    		}

    		if ($$self.$$.dirty & /*slider, max*/ 524416) {
    			 if (slider && slider.max !== max) {
    				$$invalidate(19, slider.max = max, slider);
    			}
    		}

    		if ($$self.$$.dirty & /*slider, step*/ 524544) {
    			 if (slider && slider.step !== step) {
    				$$invalidate(19, slider.step = step, slider);
    			}
    		}

    		if ($$self.$$.dirty & /*slider, value*/ 524289) {
    			 if (slider && slider.value !== value) {
    				$$invalidate(19, slider.value = value, slider);
    			}
    		}
    	};

    	$$props = exclude_internal_props($$props);

    	return [
    		value,
    		use,
    		className,
    		disabled,
    		discrete,
    		displayMarkers,
    		min,
    		max,
    		step,
    		tabindex,
    		element,
    		forwardEvents,
    		inputProps,
    		handleChange,
    		$$props,
    		layout,
    		stepUp,
    		stepDown,
    		getId,
    		slider,
    		removeLayoutListener,
    		formField,
    		addLayoutListener,
    		div4_binding
    	];
    }

    class Slider extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(this, options, instance, create_fragment, safe_not_equal, {
    			use: 1,
    			class: 2,
    			disabled: 3,
    			discrete: 4,
    			displayMarkers: 5,
    			min: 6,
    			max: 7,
    			step: 8,
    			value: 0,
    			tabindex: 9,
    			layout: 15,
    			stepUp: 16,
    			stepDown: 17,
    			getId: 18
    		});
    	}

    	get layout() {
    		return this.$$.ctx[15];
    	}

    	get stepUp() {
    		return this.$$.ctx[16];
    	}

    	get stepDown() {
    		return this.$$.ctx[17];
    	}

    	get getId() {
    		return this.$$.ctx[18];
    	}
    }

    /* src/Slider.svelte generated by Svelte v3.19.2 */

    function create_fragment$1(ctx) {
    	let div1;
    	let div0;
    	let updating_value;
    	let current;

    	function slider_value_binding(value) {
    		/*slider_value_binding*/ ctx[4].call(null, value);
    	}

    	let slider_props = {
    		style: "--mdc-theme-secondary: " + /*bgColor*/ ctx[3],
    		min: /*min*/ ctx[1],
    		max: /*max*/ ctx[2],
    		discrete: "true"
    	};

    	if (/*color*/ ctx[0] !== void 0) {
    		slider_props.value = /*color*/ ctx[0];
    	}

    	const slider = new Slider({ props: slider_props });
    	binding_callbacks.push(() => bind(slider, "value", slider_value_binding));

    	return {
    		c() {
    			div1 = element("div");
    			div0 = element("div");
    			create_component(slider.$$.fragment);
    			attr(div0, "bp", "10 offset-2");
    			attr(div1, "bp", "grid");
    		},
    		m(target, anchor) {
    			insert(target, div1, anchor);
    			append(div1, div0);
    			mount_component(slider, div0, null);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const slider_changes = {};
    			if (dirty & /*bgColor*/ 8) slider_changes.style = "--mdc-theme-secondary: " + /*bgColor*/ ctx[3];
    			if (dirty & /*min*/ 2) slider_changes.min = /*min*/ ctx[1];
    			if (dirty & /*max*/ 4) slider_changes.max = /*max*/ ctx[2];

    			if (!updating_value && dirty & /*color*/ 1) {
    				updating_value = true;
    				slider_changes.value = /*color*/ ctx[0];
    				add_flush_callback(() => updating_value = false);
    			}

    			slider.$set(slider_changes);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(slider.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(slider.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    			destroy_component(slider);
    		}
    	};
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { min = 0 } = $$props;
    	let { max = 255 } = $$props;
    	let { color = 0 } = $$props;
    	let { bgColor = "coral" } = $$props;

    	function slider_value_binding(value) {
    		color = value;
    		$$invalidate(0, color);
    	}

    	$$self.$set = $$props => {
    		if ("min" in $$props) $$invalidate(1, min = $$props.min);
    		if ("max" in $$props) $$invalidate(2, max = $$props.max);
    		if ("color" in $$props) $$invalidate(0, color = $$props.color);
    		if ("bgColor" in $$props) $$invalidate(3, bgColor = $$props.bgColor);
    	};

    	return [color, min, max, bgColor, slider_value_binding];
    }

    class Slider_1 extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, { min: 1, max: 2, color: 0, bgColor: 3 });
    	}
    }

    const rgbToHex = (r, g, b) =>
      '#' +
      [r, g, b]
        .map((x) => {
          const hex = x.toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        })
        .join('');

    /* src/App.svelte generated by Svelte v3.19.2 */

    function create_fragment$2(ctx) {
    	let div1;
    	let t1;
    	let div2;
    	let updating_color;
    	let t2;
    	let updating_color_1;
    	let t3;
    	let updating_color_2;
    	let t4;
    	let div4;
    	let div3;
    	let t5;
    	let div7;
    	let div5;
    	let t6;
    	let br0;
    	let t7;
    	let t8;
    	let t9;
    	let t10;
    	let t11;
    	let t12;
    	let t13;
    	let div6;
    	let t14;
    	let br1;
    	let t15;
    	let t16;
    	let current;

    	function slider0_color_binding(value) {
    		/*slider0_color_binding*/ ctx[4].call(null, value);
    	}

    	let slider0_props = { bgColor: "#AA0000" };

    	if (/*red*/ ctx[0] !== void 0) {
    		slider0_props.color = /*red*/ ctx[0];
    	}

    	const slider0 = new Slider_1({ props: slider0_props });
    	binding_callbacks.push(() => bind(slider0, "color", slider0_color_binding));

    	function slider1_color_binding(value) {
    		/*slider1_color_binding*/ ctx[5].call(null, value);
    	}

    	let slider1_props = { bgColor: "#00AA00" };

    	if (/*green*/ ctx[1] !== void 0) {
    		slider1_props.color = /*green*/ ctx[1];
    	}

    	const slider1 = new Slider_1({ props: slider1_props });
    	binding_callbacks.push(() => bind(slider1, "color", slider1_color_binding));

    	function slider2_color_binding(value) {
    		/*slider2_color_binding*/ ctx[6].call(null, value);
    	}

    	let slider2_props = { bgColor: "#0000AA" };

    	if (/*blue*/ ctx[2] !== void 0) {
    		slider2_props.color = /*blue*/ ctx[2];
    	}

    	const slider2 = new Slider_1({ props: slider2_props });
    	binding_callbacks.push(() => bind(slider2, "color", slider2_color_binding));

    	return {
    		c() {
    			div1 = element("div");
    			div1.innerHTML = `<div bp="10 offset-2"><h1>Color Picker</h1></div>`;
    			t1 = space();
    			div2 = element("div");
    			create_component(slider0.$$.fragment);
    			t2 = space();
    			create_component(slider1.$$.fragment);
    			t3 = space();
    			create_component(slider2.$$.fragment);
    			t4 = space();
    			div4 = element("div");
    			div3 = element("div");
    			t5 = space();
    			div7 = element("div");
    			div5 = element("div");
    			t6 = text("RGB\n    ");
    			br0 = element("br");
    			t7 = text("\n    r=");
    			t8 = text(/*red*/ ctx[0]);
    			t9 = text(", g=");
    			t10 = text(/*green*/ ctx[1]);
    			t11 = text(", b=");
    			t12 = text(/*blue*/ ctx[2]);
    			t13 = space();
    			div6 = element("div");
    			t14 = text("HEX\n    ");
    			br1 = element("br");
    			t15 = space();
    			t16 = text(/*hexColor*/ ctx[3]);
    			attr(div1, "bp", "grid");
    			attr(div1, "class", "svelte-pxdd92");
    			attr(div2, "class", "color-controls svelte-pxdd92");
    			set_style(div3, "background-color", "rgb(" + /*red*/ ctx[0] + ", " + /*green*/ ctx[1] + ", " + /*blue*/ ctx[2] + ")");
    			attr(div3, "class", "color-display svelte-pxdd92");
    			attr(div3, "bp", "10 offset-2");
    			attr(div4, "bp", "grid");
    			attr(div4, "class", "svelte-pxdd92");
    			attr(div5, "bp", "offset-2 5");
    			attr(div5, "class", "svelte-pxdd92");
    			attr(div6, "bp", "5");
    			attr(div6, "class", "svelte-pxdd92");
    			attr(div7, "bp", "grid");
    			attr(div7, "class", "color-numbers svelte-pxdd92");
    		},
    		m(target, anchor) {
    			insert(target, div1, anchor);
    			insert(target, t1, anchor);
    			insert(target, div2, anchor);
    			mount_component(slider0, div2, null);
    			append(div2, t2);
    			mount_component(slider1, div2, null);
    			append(div2, t3);
    			mount_component(slider2, div2, null);
    			insert(target, t4, anchor);
    			insert(target, div4, anchor);
    			append(div4, div3);
    			insert(target, t5, anchor);
    			insert(target, div7, anchor);
    			append(div7, div5);
    			append(div5, t6);
    			append(div5, br0);
    			append(div5, t7);
    			append(div5, t8);
    			append(div5, t9);
    			append(div5, t10);
    			append(div5, t11);
    			append(div5, t12);
    			append(div7, t13);
    			append(div7, div6);
    			append(div6, t14);
    			append(div6, br1);
    			append(div6, t15);
    			append(div6, t16);
    			current = true;
    		},
    		p(ctx, [dirty]) {
    			const slider0_changes = {};

    			if (!updating_color && dirty & /*red*/ 1) {
    				updating_color = true;
    				slider0_changes.color = /*red*/ ctx[0];
    				add_flush_callback(() => updating_color = false);
    			}

    			slider0.$set(slider0_changes);
    			const slider1_changes = {};

    			if (!updating_color_1 && dirty & /*green*/ 2) {
    				updating_color_1 = true;
    				slider1_changes.color = /*green*/ ctx[1];
    				add_flush_callback(() => updating_color_1 = false);
    			}

    			slider1.$set(slider1_changes);
    			const slider2_changes = {};

    			if (!updating_color_2 && dirty & /*blue*/ 4) {
    				updating_color_2 = true;
    				slider2_changes.color = /*blue*/ ctx[2];
    				add_flush_callback(() => updating_color_2 = false);
    			}

    			slider2.$set(slider2_changes);

    			if (!current || dirty & /*red, green, blue*/ 7) {
    				set_style(div3, "background-color", "rgb(" + /*red*/ ctx[0] + ", " + /*green*/ ctx[1] + ", " + /*blue*/ ctx[2] + ")");
    			}

    			if (!current || dirty & /*red*/ 1) set_data(t8, /*red*/ ctx[0]);
    			if (!current || dirty & /*green*/ 2) set_data(t10, /*green*/ ctx[1]);
    			if (!current || dirty & /*blue*/ 4) set_data(t12, /*blue*/ ctx[2]);
    			if (!current || dirty & /*hexColor*/ 8) set_data(t16, /*hexColor*/ ctx[3]);
    		},
    		i(local) {
    			if (current) return;
    			transition_in(slider0.$$.fragment, local);
    			transition_in(slider1.$$.fragment, local);
    			transition_in(slider2.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(slider0.$$.fragment, local);
    			transition_out(slider1.$$.fragment, local);
    			transition_out(slider2.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div1);
    			if (detaching) detach(t1);
    			if (detaching) detach(div2);
    			destroy_component(slider0);
    			destroy_component(slider1);
    			destroy_component(slider2);
    			if (detaching) detach(t4);
    			if (detaching) detach(div4);
    			if (detaching) detach(t5);
    			if (detaching) detach(div7);
    		}
    	};
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let red = 100;
    	let green = 0;
    	let blue = 100;

    	function slider0_color_binding(value) {
    		red = value;
    		$$invalidate(0, red);
    	}

    	function slider1_color_binding(value) {
    		green = value;
    		$$invalidate(1, green);
    	}

    	function slider2_color_binding(value) {
    		blue = value;
    		$$invalidate(2, blue);
    	}

    	let hexColor;

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*red, green, blue*/ 7) {
    			 $$invalidate(3, hexColor = rgbToHex(red, green, blue));
    		}
    	};

    	return [
    		red,
    		green,
    		blue,
    		hexColor,
    		slider0_color_binding,
    		slider1_color_binding,
    		slider2_color_binding
    	];
    }

    class App extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, {});
    	}
    }

    const app = new App({
      target: document.body
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
