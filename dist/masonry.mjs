/*!
 * Masonry PACKAGED v5.0.0-dev.22
 * Cascading grid layout library
 * https://github.com/oriolj/masonry-pretext
 * MIT License
 * by David DeSandro
 */
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/ev-emitter/ev-emitter.js
var require_ev_emitter = __commonJS({
  "node_modules/ev-emitter/ev-emitter.js"(exports, module) {
    (function(global, factory) {
      if (typeof define == "function" && define.amd) {
        define(factory);
      } else if (typeof module == "object" && module.exports) {
        module.exports = factory();
      } else {
        global.EvEmitter = factory();
      }
    })(typeof window != "undefined" ? window : exports, function() {
      "use strict";
      function EvEmitter() {
      }
      var proto = EvEmitter.prototype;
      proto.on = function(eventName, listener) {
        if (!eventName || !listener) {
          return;
        }
        var events = this._events = this._events || {};
        var listeners = events[eventName] = events[eventName] || [];
        if (listeners.indexOf(listener) == -1) {
          listeners.push(listener);
        }
        return this;
      };
      proto.once = function(eventName, listener) {
        if (!eventName || !listener) {
          return;
        }
        this.on(eventName, listener);
        var onceEvents = this._onceEvents = this._onceEvents || {};
        var onceListeners = onceEvents[eventName] = onceEvents[eventName] || {};
        onceListeners[listener] = true;
        return this;
      };
      proto.off = function(eventName, listener) {
        var listeners = this._events && this._events[eventName];
        if (!listeners || !listeners.length) {
          return;
        }
        var index = listeners.indexOf(listener);
        if (index != -1) {
          listeners.splice(index, 1);
        }
        return this;
      };
      proto.emitEvent = function(eventName, args) {
        var listeners = this._events && this._events[eventName];
        if (!listeners || !listeners.length) {
          return;
        }
        listeners = listeners.slice(0);
        args = args || [];
        var onceListeners = this._onceEvents && this._onceEvents[eventName];
        for (var i = 0; i < listeners.length; i++) {
          var listener = listeners[i];
          var isOnce = onceListeners && onceListeners[listener];
          if (isOnce) {
            this.off(eventName, listener);
            delete onceListeners[listener];
          }
          listener.apply(this, args);
        }
        return this;
      };
      proto.allOff = function() {
        delete this._events;
        delete this._onceEvents;
      };
      return EvEmitter;
    });
  }
});

// node_modules/get-size/get-size.js
var require_get_size = __commonJS({
  "node_modules/get-size/get-size.js"(exports, module) {
    /*!
     * getSize v2.0.3
     * measure size of elements
     * MIT license
     */
    (function(window2, factory) {
      if (typeof define == "function" && define.amd) {
        define(factory);
      } else if (typeof module == "object" && module.exports) {
        module.exports = factory();
      } else {
        window2.getSize = factory();
      }
    })(typeof window !== "undefined" ? window : {}, function factory() {
      "use strict";
      function getStyleSize(value) {
        var num = parseFloat(value);
        var isValid = value.indexOf("%") == -1 && !isNaN(num);
        return isValid && num;
      }
      function noop() {
      }
      var logError = typeof console == "undefined" ? noop : function(message) {
        console.error(message);
      };
      var measurements = [
        "paddingLeft",
        "paddingRight",
        "paddingTop",
        "paddingBottom",
        "marginLeft",
        "marginRight",
        "marginTop",
        "marginBottom",
        "borderLeftWidth",
        "borderRightWidth",
        "borderTopWidth",
        "borderBottomWidth"
      ];
      var measurementsLength = measurements.length;
      function getZeroSize() {
        var size = {
          width: 0,
          height: 0,
          innerWidth: 0,
          innerHeight: 0,
          outerWidth: 0,
          outerHeight: 0
        };
        for (var i = 0; i < measurementsLength; i++) {
          var measurement = measurements[i];
          size[measurement] = 0;
        }
        return size;
      }
      function getStyle(elem) {
        var style = getComputedStyle(elem);
        if (!style) {
          logError("Style returned " + style + ". Are you running this code in a hidden iframe on Firefox? See https://bit.ly/getsizebug1");
        }
        return style;
      }
      function getSize(elem) {
        if (typeof elem == "string") {
          elem = document.querySelector(elem);
        }
        if (!elem || typeof elem != "object" || !elem.nodeType) {
          return;
        }
        var style = getStyle(elem);
        if (style.display == "none") {
          return getZeroSize();
        }
        var size = {};
        size.width = elem.offsetWidth;
        size.height = elem.offsetHeight;
        var isBorderBox = size.isBorderBox = style.boxSizing == "border-box";
        for (var i = 0; i < measurementsLength; i++) {
          var measurement = measurements[i];
          var value = style[measurement];
          var num = parseFloat(value);
          size[measurement] = !isNaN(num) ? num : 0;
        }
        var paddingWidth = size.paddingLeft + size.paddingRight;
        var paddingHeight = size.paddingTop + size.paddingBottom;
        var marginWidth = size.marginLeft + size.marginRight;
        var marginHeight = size.marginTop + size.marginBottom;
        var borderWidth = size.borderLeftWidth + size.borderRightWidth;
        var borderHeight = size.borderTopWidth + size.borderBottomWidth;
        var styleWidth = getStyleSize(style.width);
        if (styleWidth !== false) {
          size.width = styleWidth + // add padding and border unless it's already including it
          (isBorderBox ? 0 : paddingWidth + borderWidth);
        }
        var styleHeight = getStyleSize(style.height);
        if (styleHeight !== false) {
          size.height = styleHeight + // add padding and border unless it's already including it
          (isBorderBox ? 0 : paddingHeight + borderHeight);
        }
        size.innerWidth = size.width - (paddingWidth + borderWidth);
        size.innerHeight = size.height - (paddingHeight + borderHeight);
        size.outerWidth = size.width + marginWidth;
        size.outerHeight = size.height + marginHeight;
        return size;
      }
      return getSize;
    });
  }
});

// matches-selector-shim:matches-selector-shim
var require_matches_selector_shim = __commonJS({
  "matches-selector-shim:matches-selector-shim"(exports, module) {
    module.exports = function(elem, selector) {
      return elem.matches(selector);
    };
  }
});

// node_modules/fizzy-ui-utils/utils.js
var require_utils = __commonJS({
  "node_modules/fizzy-ui-utils/utils.js"(exports, module) {
    (function(window2, factory) {
      if (typeof define == "function" && define.amd) {
        define([
          "desandro-matches-selector/matches-selector"
        ], function(matchesSelector) {
          return factory(window2, matchesSelector);
        });
      } else if (typeof module == "object" && module.exports) {
        module.exports = factory(
          window2,
          require_matches_selector_shim()
        );
      } else {
        window2.fizzyUIUtils = factory(
          window2,
          window2.matchesSelector
        );
      }
    })(typeof window !== "undefined" ? window : {}, function factory(window2, matchesSelector) {
      "use strict";
      var utils = {};
      utils.extend = function(a, b) {
        for (var prop in b) {
          a[prop] = b[prop];
        }
        return a;
      };
      var arraySlice = Array.prototype.slice;
      utils.makeArray = function(obj) {
        if (Array.isArray(obj)) {
          return obj;
        }
        if (obj === null || obj === void 0) {
          return [];
        }
        var isArrayLike = typeof obj == "object" && typeof obj.length == "number";
        if (isArrayLike) {
          return arraySlice.call(obj);
        }
        return [obj];
      };
      utils.removeFrom = function(ary, obj) {
        var index = ary.indexOf(obj);
        if (index != -1) {
          ary.splice(index, 1);
        }
      };
      utils.getQueryElement = function(elem) {
        if (typeof elem == "string") {
          return document.querySelector(elem);
        }
        return elem;
      };
      utils.handleEvent = function(event) {
        var method = "on" + event.type;
        if (this[method]) {
          this[method](event);
        }
      };
      utils.filterFindElements = function(elems, selector) {
        elems = utils.makeArray(elems);
        var ffElems = [];
        elems.forEach(function(elem) {
          if (!(elem instanceof HTMLElement)) {
            return;
          }
          if (!selector) {
            ffElems.push(elem);
            return;
          }
          if (matchesSelector(elem, selector)) {
            ffElems.push(elem);
          }
          var childElems = elem.querySelectorAll(selector);
          for (var i = 0; i < childElems.length; i++) {
            ffElems.push(childElems[i]);
          }
        });
        return ffElems;
      };
      utils.debounceMethod = function(_class, methodName, threshold) {
        threshold = threshold || 100;
        var method = _class.prototype[methodName];
        var timeoutName = methodName + "Timeout";
        _class.prototype[methodName] = function() {
          var timeout = this[timeoutName];
          clearTimeout(timeout);
          var args = arguments;
          var _this = this;
          this[timeoutName] = setTimeout(function() {
            method.apply(_this, args);
            delete _this[timeoutName];
          }, threshold);
        };
      };
      utils.docReady = function(callback) {
        if (typeof document === "undefined") return;
        var readyState = document.readyState;
        if (readyState == "complete" || readyState == "interactive") {
          callback();
        } else {
          document.addEventListener("DOMContentLoaded", callback);
        }
      };
      utils.toDashed = function(str) {
        return str.replace(/(.)([A-Z])/g, function(match, $1, $2) {
          return $1 + "-" + $2;
        }).toLowerCase();
      };
      var console2 = window2.console;
      utils.htmlInit = function(WidgetClass, namespace) {
        utils.docReady(function() {
          var dashedNamespace = utils.toDashed(namespace);
          var dataAttr = "data-" + dashedNamespace;
          var dataAttrElems = document.querySelectorAll("[" + dataAttr + "]");
          var jsDashElems = document.querySelectorAll(".js-" + dashedNamespace);
          var elems = utils.makeArray(dataAttrElems).concat(utils.makeArray(jsDashElems));
          var dataOptionsAttr = dataAttr + "-options";
          elems.forEach(function(elem) {
            var attr = elem.getAttribute(dataAttr) || elem.getAttribute(dataOptionsAttr);
            var options;
            try {
              options = attr && JSON.parse(attr);
            } catch (error) {
              if (console2) {
                console2.error("Error parsing " + dataAttr + " on " + elem.className + ": " + error);
              }
              return;
            }
            new WidgetClass(elem, options);
          });
        });
      };
      return utils;
    });
  }
});

// node_modules/outlayer/item.js
var require_item = __commonJS({
  "node_modules/outlayer/item.js"(exports, module) {
    (function(window2, factory) {
      if (typeof define == "function" && define.amd) {
        define(
          [
            "ev-emitter/ev-emitter",
            "get-size/get-size"
          ],
          factory
        );
      } else if (typeof module == "object" && module.exports) {
        module.exports = factory(
          require_ev_emitter(),
          require_get_size()
        );
      } else {
        window2.Outlayer = {};
        window2.Outlayer.Item = factory(
          window2.EvEmitter,
          window2.getSize
        );
      }
    })(typeof window !== "undefined" ? window : {}, function factory(EvEmitter, getSize) {
      "use strict";
      function isEmptyObj(obj) {
        for (var prop in obj) {
          return false;
        }
        prop = null;
        return true;
      }
      var transitionEndEvent = "transitionend";
      function Item(element, layout) {
        if (!element) {
          return;
        }
        this.element = element;
        this.layout = layout;
        this.position = {
          x: 0,
          y: 0
        };
        this._create();
      }
      var proto = Item.prototype = Object.create(EvEmitter.prototype);
      proto.constructor = Item;
      proto._create = function() {
        this._transn = {
          ingProperties: {},
          clean: {},
          onEnd: {}
        };
        this.css({
          position: "absolute"
        });
      };
      proto.handleEvent = function(event) {
        var method = "on" + event.type;
        if (this[method]) {
          this[method](event);
        }
      };
      proto.getSize = function() {
        this.size = getSize(this.element);
      };
      proto.css = function(style) {
        var elemStyle = this.element.style;
        for (var prop in style) {
          elemStyle[prop] = style[prop];
        }
      };
      proto.getPosition = function() {
        var style = getComputedStyle(this.element);
        var isOriginLeft = this.layout._getOption("originLeft");
        var isOriginTop = this.layout._getOption("originTop");
        var xValue = style[isOriginLeft ? "left" : "right"];
        var yValue = style[isOriginTop ? "top" : "bottom"];
        var x = parseFloat(xValue);
        var y = parseFloat(yValue);
        var layoutSize = this.layout.size;
        if (xValue.indexOf("%") != -1) {
          x = x / 100 * layoutSize.width;
        }
        if (yValue.indexOf("%") != -1) {
          y = y / 100 * layoutSize.height;
        }
        x = isNaN(x) ? 0 : x;
        y = isNaN(y) ? 0 : y;
        x -= isOriginLeft ? layoutSize.paddingLeft : layoutSize.paddingRight;
        y -= isOriginTop ? layoutSize.paddingTop : layoutSize.paddingBottom;
        this.position.x = x;
        this.position.y = y;
      };
      proto.layoutPosition = function() {
        var layoutSize = this.layout.size;
        var style = {};
        var isOriginLeft = this.layout._getOption("originLeft");
        var isOriginTop = this.layout._getOption("originTop");
        var xPadding = isOriginLeft ? "paddingLeft" : "paddingRight";
        var xProperty = isOriginLeft ? "left" : "right";
        var xResetProperty = isOriginLeft ? "right" : "left";
        var x = this.position.x + layoutSize[xPadding];
        style[xProperty] = this.getXValue(x);
        style[xResetProperty] = "";
        var yPadding = isOriginTop ? "paddingTop" : "paddingBottom";
        var yProperty = isOriginTop ? "top" : "bottom";
        var yResetProperty = isOriginTop ? "bottom" : "top";
        var y = this.position.y + layoutSize[yPadding];
        style[yProperty] = this.getYValue(y);
        style[yResetProperty] = "";
        this.css(style);
        this.emitEvent("layout", [this]);
      };
      proto.getXValue = function(x) {
        var isHorizontal = this.layout._getOption("horizontal");
        return this.layout.options.percentPosition && !isHorizontal ? x / this.layout.size.width * 100 + "%" : x + "px";
      };
      proto.getYValue = function(y) {
        var isHorizontal = this.layout._getOption("horizontal");
        return this.layout.options.percentPosition && isHorizontal ? y / this.layout.size.height * 100 + "%" : y + "px";
      };
      proto._transitionTo = function(x, y) {
        this.getPosition();
        var curX = this.position.x;
        var curY = this.position.y;
        var didNotMove = x == this.position.x && y == this.position.y;
        this.setPosition(x, y);
        if (didNotMove && !this.isTransitioning) {
          this.layoutPosition();
          return;
        }
        var transX = x - curX;
        var transY = y - curY;
        var transitionStyle = {};
        transitionStyle.transform = this.getTranslate(transX, transY);
        this.transition({
          to: transitionStyle,
          onTransitionEnd: {
            transform: this.layoutPosition
          },
          isCleaning: true
        });
      };
      proto.getTranslate = function(x, y) {
        var isOriginLeft = this.layout._getOption("originLeft");
        var isOriginTop = this.layout._getOption("originTop");
        x = isOriginLeft ? x : -x;
        y = isOriginTop ? y : -y;
        return "translate3d(" + x + "px, " + y + "px, 0)";
      };
      proto.goTo = function(x, y) {
        this.setPosition(x, y);
        this.layoutPosition();
      };
      proto.moveTo = proto._transitionTo;
      proto.setPosition = function(x, y) {
        this.position.x = parseFloat(x);
        this.position.y = parseFloat(y);
      };
      proto._nonTransition = function(args) {
        this.css(args.to);
        if (args.isCleaning) {
          this._removeStyles(args.to);
        }
        for (var prop in args.onTransitionEnd) {
          args.onTransitionEnd[prop].call(this);
        }
      };
      proto.transition = function(args) {
        if (!parseFloat(this.layout.options.transitionDuration)) {
          this._nonTransition(args);
          return;
        }
        var _transition = this._transn;
        for (var prop in args.onTransitionEnd) {
          _transition.onEnd[prop] = args.onTransitionEnd[prop];
        }
        for (prop in args.to) {
          _transition.ingProperties[prop] = true;
          if (args.isCleaning) {
            _transition.clean[prop] = true;
          }
        }
        if (args.from) {
          this.css(args.from);
          var h = this.element.offsetHeight;
          h = null;
        }
        this.enableTransition(args.to);
        this.css(args.to);
        this.isTransitioning = true;
      };
      var transitionProps = "opacity,transform";
      proto.enableTransition = function() {
        if (this.isTransitioning) {
          return;
        }
        var duration = this.layout.options.transitionDuration;
        duration = typeof duration == "number" ? duration + "ms" : duration;
        this.css({
          transitionProperty: transitionProps,
          transitionDuration: duration,
          transitionDelay: this.staggerDelay || 0
        });
        this.element.addEventListener(transitionEndEvent, this, false);
      };
      proto.ontransitionend = function(event) {
        if (event.target !== this.element) {
          return;
        }
        var _transition = this._transn;
        var propertyName = event.propertyName;
        delete _transition.ingProperties[propertyName];
        if (isEmptyObj(_transition.ingProperties)) {
          this.disableTransition();
        }
        if (propertyName in _transition.clean) {
          this.element.style[event.propertyName] = "";
          delete _transition.clean[propertyName];
        }
        if (propertyName in _transition.onEnd) {
          var onTransitionEnd = _transition.onEnd[propertyName];
          onTransitionEnd.call(this);
          delete _transition.onEnd[propertyName];
        }
        this.emitEvent("transitionEnd", [this]);
      };
      proto.disableTransition = function() {
        this.removeTransitionStyles();
        this.element.removeEventListener(transitionEndEvent, this, false);
        this.isTransitioning = false;
      };
      proto._removeStyles = function(style) {
        var cleanStyle = {};
        for (var prop in style) {
          cleanStyle[prop] = "";
        }
        this.css(cleanStyle);
      };
      var cleanTransitionStyle = {
        transitionProperty: "",
        transitionDuration: "",
        transitionDelay: ""
      };
      proto.removeTransitionStyles = function() {
        this.css(cleanTransitionStyle);
      };
      proto.stagger = function(delay) {
        delay = isNaN(delay) ? 0 : delay;
        this.staggerDelay = delay + "ms";
      };
      proto.removeElem = function() {
        this.element.parentNode.removeChild(this.element);
        this.css({ display: "" });
        this.emitEvent("remove", [this]);
      };
      proto.remove = function() {
        if (!parseFloat(this.layout.options.transitionDuration)) {
          this.removeElem();
          return;
        }
        this.once("transitionEnd", function() {
          this.removeElem();
        });
        this.hide();
      };
      proto.reveal = function() {
        delete this.isHidden;
        this.css({ display: "" });
        var options = this.layout.options;
        var onTransitionEnd = {};
        var transitionEndProperty = this.getHideRevealTransitionEndProperty("visibleStyle");
        onTransitionEnd[transitionEndProperty] = this.onRevealTransitionEnd;
        this.transition({
          from: options.hiddenStyle,
          to: options.visibleStyle,
          isCleaning: true,
          onTransitionEnd
        });
      };
      proto.onRevealTransitionEnd = function() {
        if (!this.isHidden) {
          this.emitEvent("reveal");
        }
      };
      proto.getHideRevealTransitionEndProperty = function(styleProperty) {
        var optionStyle = this.layout.options[styleProperty];
        if (optionStyle.opacity) {
          return "opacity";
        }
        for (var prop in optionStyle) {
          return prop;
        }
      };
      proto.hide = function() {
        this.isHidden = true;
        this.css({ display: "" });
        var options = this.layout.options;
        var onTransitionEnd = {};
        var transitionEndProperty = this.getHideRevealTransitionEndProperty("hiddenStyle");
        onTransitionEnd[transitionEndProperty] = this.onHideTransitionEnd;
        this.transition({
          from: options.visibleStyle,
          to: options.hiddenStyle,
          // keep hidden stuff hidden
          isCleaning: true,
          onTransitionEnd
        });
      };
      proto.onHideTransitionEnd = function() {
        if (this.isHidden) {
          this.css({ display: "none" });
          this.emitEvent("hide");
        }
      };
      proto.destroy = function() {
        this.css({
          position: "",
          left: "",
          right: "",
          top: "",
          bottom: "",
          transition: "",
          transform: ""
        });
      };
      return Item;
    });
  }
});

// node_modules/outlayer/outlayer.js
var require_outlayer = __commonJS({
  "node_modules/outlayer/outlayer.js"(exports, module) {
    /*!
     * Outlayer v2.1.1
     * the brains and guts of a layout library
     * MIT license
     */
    (function(window2, factory) {
      "use strict";
      if (typeof define == "function" && define.amd) {
        define(
          [
            "ev-emitter/ev-emitter",
            "get-size/get-size",
            "fizzy-ui-utils/utils",
            "./item"
          ],
          function(EvEmitter, getSize, utils, Item) {
            return factory(window2, EvEmitter, getSize, utils, Item);
          }
        );
      } else if (typeof module == "object" && module.exports) {
        module.exports = factory(
          window2,
          require_ev_emitter(),
          require_get_size(),
          require_utils(),
          require_item()
        );
      } else {
        window2.Outlayer = factory(
          window2,
          window2.EvEmitter,
          window2.getSize,
          window2.fizzyUIUtils,
          window2.Outlayer.Item
        );
      }
    })(typeof window !== "undefined" ? window : {}, function factory(window2, EvEmitter, getSize, utils, Item) {
      "use strict";
      var console2 = window2.console;
      var noop = function() {
      };
      var GUID = 0;
      var instances = {};
      function Outlayer(element, options) {
        var queryElement = utils.getQueryElement(element);
        if (!queryElement) {
          if (console2) {
            console2.error("Bad element for " + this.constructor.namespace + ": " + (queryElement || element));
          }
          return;
        }
        this.element = queryElement;
        this.options = utils.extend({}, this.constructor.defaults);
        this.option(options);
        var id = ++GUID;
        this.element.outlayerGUID = id;
        instances[id] = this;
        this._create();
        var isInitLayout = this._getOption("initLayout");
        if (isInitLayout) {
          this.layout();
        }
      }
      Outlayer.namespace = "outlayer";
      Outlayer.Item = Item;
      Outlayer.defaults = {
        containerStyle: {
          position: "relative"
        },
        initLayout: true,
        originLeft: true,
        originTop: true,
        resize: true,
        resizeContainer: true,
        // item options
        transitionDuration: "0.4s",
        hiddenStyle: {
          opacity: 0,
          transform: "scale(0.001)"
        },
        visibleStyle: {
          opacity: 1,
          transform: "scale(1)"
        }
      };
      var proto = Outlayer.prototype;
      utils.extend(proto, EvEmitter.prototype);
      proto.option = function(opts) {
        utils.extend(this.options, opts);
      };
      proto._getOption = function(option) {
        var oldOption = this.constructor.compatOptions[option];
        return oldOption && this.options[oldOption] !== void 0 ? this.options[oldOption] : this.options[option];
      };
      Outlayer.compatOptions = {
        // currentName: oldName
        initLayout: "isInitLayout",
        horizontal: "isHorizontal",
        layoutInstant: "isLayoutInstant",
        originLeft: "isOriginLeft",
        originTop: "isOriginTop",
        resize: "isResizeBound",
        resizeContainer: "isResizingContainer"
      };
      proto._create = function() {
        this.reloadItems();
        this.stamps = [];
        this.stamp(this.options.stamp);
        utils.extend(this.element.style, this.options.containerStyle);
        var canBindResize = this._getOption("resize");
        if (canBindResize) {
          this.bindResize();
        }
      };
      proto.reloadItems = function() {
        this.items = this._itemize(this.element.children);
      };
      proto._itemize = function(elems) {
        var itemElems = this._filterFindItemElements(elems);
        var Item2 = this.constructor.Item;
        var items = [];
        for (var i = 0; i < itemElems.length; i++) {
          var elem = itemElems[i];
          var item = new Item2(elem, this);
          items.push(item);
        }
        return items;
      };
      proto._filterFindItemElements = function(elems) {
        return utils.filterFindElements(elems, this.options.itemSelector);
      };
      proto.getItemElements = function() {
        return this.items.map(function(item) {
          return item.element;
        });
      };
      proto.layout = function() {
        this._resetLayout();
        this._manageStamps();
        var layoutInstant = this._getOption("layoutInstant");
        var isInstant = layoutInstant !== void 0 ? layoutInstant : !this._isLayoutInited;
        this.layoutItems(this.items, isInstant);
        this._isLayoutInited = true;
      };
      proto._init = proto.layout;
      proto._resetLayout = function() {
        this.getSize();
      };
      proto.getSize = function() {
        this.size = getSize(this.element);
      };
      proto._getMeasurement = function(measurement, size) {
        var option = this.options[measurement];
        var elem;
        if (!option) {
          this[measurement] = 0;
        } else {
          if (typeof option == "string") {
            elem = this.element.querySelector(option);
          } else if (option instanceof HTMLElement) {
            elem = option;
          }
          this[measurement] = elem ? getSize(elem)[size] : option;
        }
      };
      proto.layoutItems = function(items, isInstant) {
        items = this._getItemsForLayout(items);
        this._layoutItems(items, isInstant);
        this._postLayout();
      };
      proto._getItemsForLayout = function(items) {
        return items.filter(function(item) {
          return !item.isIgnored;
        });
      };
      proto._layoutItems = function(items, isInstant) {
        this._emitCompleteOnItems("layout", items);
        if (!items || !items.length) {
          return;
        }
        var queue = [];
        items.forEach(function(item) {
          var position = this._getItemLayoutPosition(item);
          position.item = item;
          position.isInstant = isInstant || item.isLayoutInstant;
          queue.push(position);
        }, this);
        this._processLayoutQueue(queue);
      };
      proto._getItemLayoutPosition = function() {
        return {
          x: 0,
          y: 0
        };
      };
      proto._processLayoutQueue = function(queue) {
        this.updateStagger();
        queue.forEach(function(obj, i) {
          this._positionItem(obj.item, obj.x, obj.y, obj.isInstant, i);
        }, this);
      };
      proto.updateStagger = function() {
        var stagger = this.options.stagger;
        if (stagger === null || stagger === void 0) {
          this.stagger = 0;
          return;
        }
        this.stagger = getMilliseconds(stagger);
        return this.stagger;
      };
      proto._positionItem = function(item, x, y, isInstant, i) {
        if (isInstant) {
          item.goTo(x, y);
        } else {
          item.stagger(i * this.stagger);
          item.moveTo(x, y);
        }
      };
      proto._postLayout = function() {
        this.resizeContainer();
      };
      proto.resizeContainer = function() {
        var isResizingContainer = this._getOption("resizeContainer");
        if (!isResizingContainer) {
          return;
        }
        var size = this._getContainerSize();
        if (size) {
          this._setContainerMeasure(size.width, true);
          this._setContainerMeasure(size.height, false);
        }
      };
      proto._getContainerSize = noop;
      proto._setContainerMeasure = function(measure, isWidth) {
        if (measure === void 0) {
          return;
        }
        var elemSize = this.size;
        if (elemSize.isBorderBox) {
          measure += isWidth ? elemSize.paddingLeft + elemSize.paddingRight + elemSize.borderLeftWidth + elemSize.borderRightWidth : elemSize.paddingBottom + elemSize.paddingTop + elemSize.borderTopWidth + elemSize.borderBottomWidth;
        }
        measure = Math.max(measure, 0);
        this.element.style[isWidth ? "width" : "height"] = measure + "px";
      };
      proto._emitCompleteOnItems = function(eventName, items) {
        var _this = this;
        function onComplete() {
          _this.dispatchEvent(eventName + "Complete", null, [items]);
        }
        var count = items.length;
        if (!items || !count) {
          onComplete();
          return;
        }
        var doneCount = 0;
        function tick() {
          doneCount++;
          if (doneCount == count) {
            onComplete();
          }
        }
        items.forEach(function(item) {
          item.once(eventName, tick);
        });
      };
      proto.dispatchEvent = function(type, event, args) {
        var emitArgs = event ? [event].concat(args) : args;
        this.emitEvent(type, emitArgs);
      };
      proto.ignore = function(elem) {
        var item = this.getItem(elem);
        if (item) {
          item.isIgnored = true;
        }
      };
      proto.unignore = function(elem) {
        var item = this.getItem(elem);
        if (item) {
          delete item.isIgnored;
        }
      };
      proto.stamp = function(elems) {
        elems = this._find(elems);
        if (!elems) {
          return;
        }
        this.stamps = this.stamps.concat(elems);
        elems.forEach(this.ignore, this);
      };
      proto.unstamp = function(elems) {
        elems = this._find(elems);
        if (!elems) {
          return;
        }
        elems.forEach(function(elem) {
          utils.removeFrom(this.stamps, elem);
          this.unignore(elem);
        }, this);
      };
      proto._find = function(elems) {
        if (!elems) {
          return;
        }
        if (typeof elems == "string") {
          elems = this.element.querySelectorAll(elems);
        }
        elems = utils.makeArray(elems);
        return elems;
      };
      proto._manageStamps = function() {
        if (!this.stamps || !this.stamps.length) {
          return;
        }
        this._getBoundingRect();
        this.stamps.forEach(this._manageStamp, this);
      };
      proto._getBoundingRect = function() {
        var boundingRect = this.element.getBoundingClientRect();
        var size = this.size;
        this._boundingRect = {
          left: boundingRect.left + size.paddingLeft + size.borderLeftWidth,
          top: boundingRect.top + size.paddingTop + size.borderTopWidth,
          right: boundingRect.right - (size.paddingRight + size.borderRightWidth),
          bottom: boundingRect.bottom - (size.paddingBottom + size.borderBottomWidth)
        };
      };
      proto._manageStamp = noop;
      proto._getElementOffset = function(elem) {
        var boundingRect = elem.getBoundingClientRect();
        var thisRect = this._boundingRect;
        var size = getSize(elem);
        var offset = {
          left: boundingRect.left - thisRect.left - size.marginLeft,
          top: boundingRect.top - thisRect.top - size.marginTop,
          right: thisRect.right - boundingRect.right - size.marginRight,
          bottom: thisRect.bottom - boundingRect.bottom - size.marginBottom
        };
        return offset;
      };
      proto.handleEvent = utils.handleEvent;
      proto.bindResize = function() {
        window2.addEventListener("resize", this);
        this.isResizeBound = true;
      };
      proto.unbindResize = function() {
        window2.removeEventListener("resize", this);
        this.isResizeBound = false;
      };
      proto.onresize = function() {
        this.resize();
      };
      utils.debounceMethod(Outlayer, "onresize", 100);
      proto.resize = function() {
        if (!this.isResizeBound || !this.needsResizeLayout()) {
          return;
        }
        this.layout();
      };
      proto.needsResizeLayout = function() {
        var size = getSize(this.element);
        var hasSizes = this.size && size;
        return hasSizes && size.innerWidth !== this.size.innerWidth;
      };
      proto.addItems = function(elems) {
        var items = this._itemize(elems);
        if (items.length) {
          this.items = this.items.concat(items);
        }
        return items;
      };
      proto.appended = function(elems) {
        var items = this.addItems(elems);
        if (!items.length) {
          return;
        }
        this.layoutItems(items, true);
        this.reveal(items);
      };
      proto.prepended = function(elems) {
        var items = this._itemize(elems);
        if (!items.length) {
          return;
        }
        var previousItems = this.items.slice(0);
        this.items = items.concat(previousItems);
        this._resetLayout();
        this._manageStamps();
        this.layoutItems(items, true);
        this.reveal(items);
        this.layoutItems(previousItems);
      };
      proto.reveal = function(items) {
        this._emitCompleteOnItems("reveal", items);
        if (!items || !items.length) {
          return;
        }
        var stagger = this.updateStagger();
        items.forEach(function(item, i) {
          item.stagger(i * stagger);
          item.reveal();
        });
      };
      proto.hide = function(items) {
        this._emitCompleteOnItems("hide", items);
        if (!items || !items.length) {
          return;
        }
        var stagger = this.updateStagger();
        items.forEach(function(item, i) {
          item.stagger(i * stagger);
          item.hide();
        });
      };
      proto.revealItemElements = function(elems) {
        var items = this.getItems(elems);
        this.reveal(items);
      };
      proto.hideItemElements = function(elems) {
        var items = this.getItems(elems);
        this.hide(items);
      };
      proto.getItem = function(elem) {
        for (var i = 0; i < this.items.length; i++) {
          var item = this.items[i];
          if (item.element == elem) {
            return item;
          }
        }
      };
      proto.getItems = function(elems) {
        elems = utils.makeArray(elems);
        var items = [];
        elems.forEach(function(elem) {
          var item = this.getItem(elem);
          if (item) {
            items.push(item);
          }
        }, this);
        return items;
      };
      proto.remove = function(elems) {
        var removeItems = this.getItems(elems);
        this._emitCompleteOnItems("remove", removeItems);
        if (!removeItems || !removeItems.length) {
          return;
        }
        removeItems.forEach(function(item) {
          item.remove();
          utils.removeFrom(this.items, item);
        }, this);
      };
      proto.destroy = function() {
        var style = this.element.style;
        style.height = "";
        style.position = "";
        style.width = "";
        this.items.forEach(function(item) {
          item.destroy();
        });
        this.unbindResize();
        var id = this.element.outlayerGUID;
        delete instances[id];
        delete this.element.outlayerGUID;
      };
      Outlayer.data = function(elem) {
        elem = utils.getQueryElement(elem);
        var id = elem && elem.outlayerGUID;
        return id && instances[id];
      };
      Outlayer.create = function(namespace, options) {
        var Layout = subclass(Outlayer);
        Layout.defaults = utils.extend({}, Outlayer.defaults);
        utils.extend(Layout.defaults, options);
        Layout.compatOptions = utils.extend({}, Outlayer.compatOptions);
        Layout.namespace = namespace;
        Layout.data = Outlayer.data;
        Layout.Item = subclass(Item);
        utils.htmlInit(Layout, namespace);
        return Layout;
      };
      function subclass(Parent) {
        function SubClass() {
          Parent.apply(this, arguments);
        }
        SubClass.prototype = Object.create(Parent.prototype);
        SubClass.prototype.constructor = SubClass;
        return SubClass;
      }
      var msUnits = {
        ms: 1,
        s: 1e3
      };
      function getMilliseconds(time) {
        if (typeof time == "number") {
          return time;
        }
        var matches = time.match(/(^\d*\.?\d*)(\w*)/);
        var num = matches && matches[1];
        var unit = matches && matches[2];
        if (!num.length) {
          return 0;
        }
        num = parseFloat(num);
        var mult = msUnits[unit] || 1;
        return num * mult;
      }
      Outlayer.Item = Item;
      return Outlayer;
    });
  }
});

// masonry.js
var require_masonry = __commonJS({
  "masonry.js"(exports, module) {
    /*!
     * Masonry v4.2.2
     * Cascading grid layout library
     * https://masonry.desandro.com
     * MIT License
     * by David DeSandro
     */
    (function(window2, factory) {
      if (typeof define == "function" && define.amd) {
        define(
          [
            "outlayer/outlayer",
            "get-size/get-size"
          ],
          factory
        );
      } else if (typeof module == "object" && module.exports) {
        module.exports = factory(
          require_outlayer(),
          require_get_size()
        );
      } else {
        window2.Masonry = factory(
          window2.Outlayer,
          window2.getSize
        );
      }
    })(typeof window !== "undefined" ? window : {}, function factory(Outlayer, getSize) {
      "use strict";
      var Masonry2 = Outlayer.create("masonry");
      Masonry2.compatOptions.fitWidth = "isFitWidth";
      var proto = Masonry2.prototype;
      var PERCENT_RE = /^\s*(\d*\.?\d+)\s*%\s*$/;
      function detectPercentWidth(elem) {
        var inline = elem.style && elem.style.width;
        var inlineMatch = inline && inline.match(PERCENT_RE);
        if (inlineMatch) return parseFloat(inlineMatch[1]);
        if (typeof document === "undefined" || !document.styleSheets) return null;
        var found = null;
        for (var i = 0; i < document.styleSheets.length; i++) {
          var rules;
          try {
            rules = document.styleSheets[i].cssRules;
          } catch (e) {
            continue;
          }
          if (rules) {
            var inner = scanRulesForPercentWidth(rules, elem);
            if (inner !== null) found = inner;
          }
        }
        return found;
      }
      function detectPercentForOption(optCW, container) {
        if (typeof optCW === "string") {
          var literalMatch = optCW.match(PERCENT_RE);
          if (literalMatch) return parseFloat(literalMatch[1]);
          var sizer = container && container.querySelector(optCW);
          return sizer ? detectPercentWidth(sizer) : null;
        }
        if (optCW instanceof HTMLElement) {
          return detectPercentWidth(optCW);
        }
        return null;
      }
      function scanRulesForPercentWidth(rules, elem) {
        var found = null;
        for (var i = 0; i < rules.length; i++) {
          var rule = rules[i];
          if (rule.media && rule.media.mediaText && typeof window !== "undefined" && window.matchMedia && !window.matchMedia(rule.media.mediaText).matches) {
            continue;
          }
          if (rule.style && rule.selectorText && rule.style.width && /%\s*$/.test(rule.style.width)) {
            try {
              if (elem.matches(rule.selectorText)) {
                var m = rule.style.width.match(/(\d*\.?\d+)\s*%/);
                if (m) found = parseFloat(m[1]);
              }
            } catch (e) {
            }
          }
          if (rule.cssRules) {
            var inner = scanRulesForPercentWidth(rule.cssRules, elem);
            if (inner !== null) found = inner;
          }
        }
        return found;
      }
      function placeItem(size, state) {
        var columnWidth = state.columnWidth;
        var cols = state.cols;
        var colYs = state.colYs;
        var remainder = size.outerWidth % columnWidth;
        var mathMethod = remainder && remainder < 1 ? "round" : "ceil";
        var colSpan = Math[mathMethod](size.outerWidth / columnWidth);
        colSpan = Math.min(colSpan, cols);
        var pos;
        if (state.horizontalOrder) {
          pos = getHorizontalColPosition(colSpan, size, state);
          state.horizontalColIndex = pos.newHorizontalColIndex;
        } else {
          pos = getTopColPosition(colSpan, colYs, cols);
        }
        var x = columnWidth * pos.col;
        var y = pos.y;
        var setHeight = y + size.outerHeight;
        var setMax = colSpan + pos.col;
        for (var i = pos.col; i < setMax; i++) {
          colYs[i] = setHeight;
        }
        return { x, y, col: pos.col, colSpan };
      }
      function getTopColPosition(colSpan, colYs, cols) {
        var colGroup = getTopColGroup(colSpan, colYs, cols);
        var minimumY = Math.min.apply(Math, colGroup);
        return {
          col: colGroup.indexOf(minimumY),
          y: minimumY
        };
      }
      function getTopColGroup(colSpan, colYs, cols) {
        if (colSpan < 2) {
          return colYs;
        }
        var colGroup = [];
        var groupCount = cols + 1 - colSpan;
        for (var i = 0; i < groupCount; i++) {
          colGroup[i] = getColGroupY(i, colSpan, colYs);
        }
        return colGroup;
      }
      function getColGroupY(col, colSpan, colYs) {
        if (colSpan < 2) {
          return colYs[col];
        }
        var groupColYs = colYs.slice(col, col + colSpan);
        return Math.max.apply(Math, groupColYs);
      }
      function getHorizontalColPosition(colSpan, size, state) {
        var col = state.horizontalColIndex % state.cols;
        var isOver = colSpan > 1 && col + colSpan > state.cols;
        col = isOver ? 0 : col;
        var hasSize = size.outerWidth && size.outerHeight;
        var newHorizontalColIndex = hasSize ? col + colSpan : state.horizontalColIndex;
        return {
          col,
          y: getColGroupY(col, colSpan, state.colYs),
          newHorizontalColIndex
        };
      }
      function deriveCols(containerWidth, columnWidth, gutter, columnWidthPercent) {
        if (columnWidthPercent) {
          var cols = Math.max(1, Math.round(100 / columnWidthPercent));
          return { cols, stride: (containerWidth + gutter) / cols };
        }
        var stride = columnWidth + gutter;
        var paddedWidth = containerWidth + gutter;
        var rawCols = paddedWidth / stride;
        var excess = stride - paddedWidth % stride;
        var mathMethod = excess && excess < 1 ? "round" : "floor";
        return {
          cols: Math.max(1, Math[mathMethod](rawCols)),
          stride
        };
      }
      function applyStamp(colYs, cols, stride, firstX, lastX, stampMaxY) {
        var firstCol = Math.max(0, Math.floor(firstX / stride));
        var lastCol = Math.floor(lastX / stride);
        lastCol -= lastX % stride ? 0 : 1;
        lastCol = Math.min(cols - 1, lastCol);
        for (var i = firstCol; i <= lastCol; i++) {
          colYs[i] = Math.max(stampMaxY, colYs[i]);
        }
      }
      function computeFitContainerWidth(cols, colYs, stride, gutter) {
        var unusedCols = 0;
        var i = cols;
        while (--i) {
          if (colYs[i] !== 0) break;
          unusedCols++;
        }
        return (cols - unusedCols) * stride - gutter;
      }
      var baseCreate = proto._create;
      proto._create = function() {
        if (this.options.static) {
          this.options.transitionDuration = 0;
        }
        baseCreate.call(this);
        if (!this.options.static && typeof document !== "undefined" && document.fonts && document.fonts.status !== "loaded") {
          var self1 = this;
          document.fonts.ready.then(function() {
            if (self1.element && self1.element.outlayerGUID) {
              self1.layout();
            }
          });
        }
        if (!this.options.static && typeof ResizeObserver !== "undefined") {
          var self2 = this;
          this._resizeLastSizes = /* @__PURE__ */ new WeakMap();
          var pendingRaf = null;
          this._resizeObserver = new ResizeObserver(function(entries) {
            var changed = false;
            for (var i2 = 0; i2 < entries.length; i2++) {
              var entry = entries[i2];
              var box = entry.borderBoxSize && entry.borderBoxSize[0];
              var w = box ? box.inlineSize : entry.contentRect.width;
              var h = box ? box.blockSize : entry.contentRect.height;
              var prev = self2._resizeLastSizes.get(entry.target);
              if (prev && (prev.width !== w || prev.height !== h)) {
                changed = true;
              }
              self2._resizeLastSizes.set(entry.target, { width: w, height: h });
            }
            if (changed && pendingRaf === null) {
              pendingRaf = requestAnimationFrame(function() {
                pendingRaf = null;
                if (self2.element && self2.element.outlayerGUID) {
                  self2.layout();
                }
              });
            }
          });
          for (var i = 0; i < this.items.length; i++) {
            this._observeItemElement(this.items[i].element);
          }
        }
      };
      proto._observeItemElement = function(elem) {
        var rect = elem.getBoundingClientRect();
        this._resizeLastSizes.set(elem, { width: rect.width, height: rect.height });
        this._resizeObserver.observe(elem);
      };
      var baseItemize = proto._itemize;
      proto._itemize = function(elems) {
        var items = baseItemize.call(this, elems);
        if (this._resizeObserver) {
          for (var i = 0; i < items.length; i++) {
            this._observeItemElement(items[i].element);
          }
        }
        return items;
      };
      var baseRemove = proto.remove;
      proto.remove = function(elems) {
        if (this._resizeObserver) {
          var removeItems = this.getItems(elems);
          for (var i = 0; i < removeItems.length; i++) {
            this._resizeObserver.unobserve(removeItems[i].element);
          }
        }
        return baseRemove.call(this, elems);
      };
      var baseDestroy = proto.destroy;
      proto.destroy = function() {
        if (this._resizeObserver) {
          this._resizeObserver.disconnect();
          this._resizeObserver = null;
        }
        return baseDestroy.call(this);
      };
      proto._resetLayout = function() {
        this.getSize();
        var optCW = this.options.columnWidth;
        if (this._percentCacheKey !== optCW) {
          this._percentCacheKey = optCW;
          this._percentCacheValue = detectPercentForOption(optCW, this.element);
        }
        this._columnWidthPercent = this._percentCacheValue;
        if (this._columnWidthPercent !== null && typeof optCW === "string" && PERCENT_RE.test(optCW)) {
          this.columnWidth = 0;
        } else {
          this._getMeasurement("columnWidth", "outerWidth");
        }
        this._getMeasurement("gutter", "outerWidth");
        this.measureColumns();
        this.colYs = [];
        for (var i = 0; i < this.cols; i++) {
          this.colYs.push(0);
        }
        this.maxY = 0;
        this.horizontalColIndex = 0;
      };
      proto.measureColumns = function() {
        this.getContainerWidth();
        if (!this.columnWidth && !this._columnWidthPercent) {
          var firstItem = this.items[0];
          var firstItemElem = firstItem && firstItem.element;
          this.columnWidth = firstItemElem && getSize(firstItemElem).outerWidth || this.containerWidth;
        }
        var derived = deriveCols(
          this.containerWidth,
          this.columnWidth,
          this.gutter,
          this._columnWidthPercent
        );
        this.cols = derived.cols;
        this.columnWidth = derived.stride;
      };
      proto.getContainerWidth = function() {
        var isFitWidth = this._getOption("fitWidth");
        var container = isFitWidth ? this.element.parentNode : this.element;
        var size = getSize(container);
        this.containerWidth = size && size.innerWidth;
      };
      proto._getItemLayoutPosition = function(item) {
        var pretextify = this.options.pretextify;
        var pretextSize = pretextify && pretextify(item.element);
        if (pretextSize) {
          item.size = pretextSize;
        } else {
          item.getSize();
        }
        var state = {
          cols: this.cols,
          colYs: this.colYs,
          columnWidth: this.columnWidth,
          horizontalColIndex: this.horizontalColIndex,
          horizontalOrder: this.options.horizontalOrder
        };
        var result = placeItem(item.size, state);
        this.horizontalColIndex = state.horizontalColIndex;
        return { x: result.x, y: result.y };
      };
      proto._getTopColPosition = function(colSpan) {
        return getTopColPosition(colSpan, this.colYs, this.cols);
      };
      proto._getTopColGroup = function(colSpan) {
        return getTopColGroup(colSpan, this.colYs, this.cols);
      };
      proto._getColGroupY = function(col, colSpan) {
        return getColGroupY(col, colSpan, this.colYs);
      };
      proto._getHorizontalColPosition = function(colSpan, item) {
        var state = {
          cols: this.cols,
          colYs: this.colYs,
          horizontalColIndex: this.horizontalColIndex
        };
        var result = getHorizontalColPosition(colSpan, item.size, state);
        this.horizontalColIndex = result.newHorizontalColIndex;
        return { col: result.col, y: result.y };
      };
      proto._manageStamp = function(stamp) {
        var stampSize = getSize(stamp);
        var offset = this._getElementOffset(stamp);
        var isOriginLeft = this._getOption("originLeft");
        var firstX = isOriginLeft ? offset.left : offset.right;
        var lastX = firstX + stampSize.outerWidth;
        var isOriginTop = this._getOption("originTop");
        var stampMaxY = (isOriginTop ? offset.top : offset.bottom) + stampSize.outerHeight;
        applyStamp(this.colYs, this.cols, this.columnWidth, firstX, lastX, stampMaxY);
      };
      proto._getContainerSize = function() {
        this.maxY = Math.max.apply(Math, this.colYs);
        var size = {
          height: this.maxY
        };
        if (this._getOption("fitWidth")) {
          size.width = this._getContainerFitWidth();
        }
        return size;
      };
      proto._getContainerFitWidth = function() {
        return computeFitContainerWidth(this.cols, this.colYs, this.columnWidth, this.gutter);
      };
      proto.needsResizeLayout = function() {
        var previousWidth = this.containerWidth;
        this.getContainerWidth();
        return previousWidth != this.containerWidth;
      };
      Masonry2.computeLayout = function(opts) {
        var items = opts.items || [];
        var gutter = opts.gutter || 0;
        var stamps = opts.stamps || [];
        var derived = deriveCols(
          opts.containerWidth,
          opts.columnWidth,
          gutter,
          opts.columnWidthPercent
        );
        var cols = derived.cols;
        var stride = derived.stride;
        var colYs = new Array(cols);
        for (var z = 0; z < cols; z++) colYs[z] = 0;
        for (var s = 0; s < stamps.length; s++) {
          var stamp = stamps[s];
          applyStamp(
            colYs,
            cols,
            stride,
            stamp.x,
            stamp.x + stamp.width,
            stamp.y + stamp.height
          );
        }
        var state = {
          cols,
          colYs,
          columnWidth: stride,
          horizontalColIndex: 0,
          horizontalOrder: !!opts.horizontalOrder
        };
        var positions = new Array(items.length);
        for (var i = 0; i < items.length; i++) {
          var result = placeItem(items[i], state);
          positions[i] = { x: result.x, y: result.y };
        }
        var out = {
          positions,
          cols,
          columnWidth: stride,
          containerHeight: colYs.length ? Math.max.apply(Math, colYs) : 0
        };
        if (opts.fitWidth) {
          out.containerWidth = computeFitContainerWidth(cols, colYs, stride, gutter);
        }
        return out;
      };
      return Masonry2;
    });
  }
});

// masonry-esm-entry.mjs
var import_masonry = __toESM(require_masonry(), 1);
var masonry_esm_entry_default = import_masonry.default;
export {
  masonry_esm_entry_default as default
};
