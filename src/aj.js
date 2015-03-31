"use strict";

(function(){
  var Aj = {
    sync : function () {
      //setTimeout(function(){
      Platform.performMicrotaskCheckpoint();
      //},0);
    },
  };
  Aj.config = {
    log : true,
    autoSyncAfterJqueryAjax: true,
    nonObjectMetaConvertor: function(meta){
      var type = typeof meta;
      if(type === "string"){
        return {
          _selector: meta
        }
      }else if (type === "function"){
        return {
          _on_change : meta
        }
      }else{
        throw "Not supported meta data type:" + type
              + "\n"
              + JSON.stringify(meta);
      }
    },
    metaFieldClassifier : function (fieldName, metaId) {
      if (fieldName === "_index") {
        return "_prop";
      } else if (fieldName === "_splice"){
        return "_splice";
      } else if (fieldName.indexOf("_") === 0) {
        return "_value";
      } else {
        return "_prop";
      }
    },
    metaRewritter: {
      _selector : {
        priority : 10000000 - 700, 
        fn : function (meta) {
          //rewrite selector to extract attr operations
          var attrOpIndex = meta._selector.indexOf("@>");
          if (attrOpIndex >= 0) {
            meta._attr_op = meta._selector.substr(attrOpIndex + 2);
            meta._selector = meta._selector.substring(0, attrOpIndex);
          }
          meta._selector_after_attr_op = meta._selector;
        }
      },
      //missing _attr_op
      _selector_after_attr_op : {
        priority : 10000000 - 500, 
        fn : function (meta) {
          if (!meta._render) {
            meta._render = function (target, newValue, oldValue) {
              target.text(newValue);
            };
          }
          if(!meta._register_render){
            meta._register_render = function(scope, target, changeHandler){
              var path = this._target_path;
              var observer = scope.registerPathObserver(path, function(newValue, oldValue){
                changeHandler(target, newValue, oldValue);
              });
              return function(){
                changeHandler(target, Path.get(path).getValueFrom(scope), undefined);
              }
            }
          }
          if(!meta._on_dom_change){//even we do not need it
            meta._on_dom_change = function(scope, value){
              var path = Path.get(this._target_path);
              path.setValueFrom(scope, value);
            }
          }
          
          //revive _selector because we will need it later
          meta._selector = meta._selector_after_attr_op;
          
          
        }
      },
      _render : {
        priority : 10000000 -400, // a little smaller than bigger
        fn : function (meta) {
          if(!meta._on_change){
            meta._on_change = meta._render;
          }
        }
      },
      _register_render : {
        priority : 10000000 - 300, // a little smaller than bigger
        fn : function (meta) {
          if(!meta._register_on_change){
            var _register_render = meta._register_render;
            var _selector = meta._selector_keep_to_final;
            meta._register_on_change = function(bindContext, changeHandler){
              var snippet = bindContext;
              var scope = snippet._scope;
              var target = snippet._root.find(this._selector);
              return _register_render.call(this, scope, target, changeHandler);
            }
          }
        }
      },
      _on_dom_change : {
        priority : 10000000 - 200, // a little smaller than bigger
        fn : function (meta) {
          if(!meta._assign){
            meta._assign = meta._on_dom_change;
          }
        }
      },
      _register_on_dom_change : {
        priority : 10000000 - 100, // a little smaller than bigger
        fn : function (meta) {
          if (!meta._register_assign) {
            var _register_on_dom_change = meta._register_on_dom_change;
            meta._register_assign = function(bindContext, changeHandler){
              var snippet = bindContext;
              var root = snippet._root;
              var target = root.find(this._selector);
              return _register_on_dom_change.call(this, target, changeHandler);
            }
          }
        }
      },
      /*
      _selector_keep_to_final : {
        priority : 10000000, // a little smaller than bigger
        fn : function(){} //do nothing
      }
      */
    },
    scopeCreate: function(){
      return new Scope();
    }
  };
  
  Aj.log = Aj.config.log ? function(){
    console.log.apply(console, arguments);
  } : function(){};
  
  var __ordered_metaRewritter = null;
  var __getOrderedMetaRewritter = function(){
    if(__ordered_metaRewritter){
      return __ordered_metaRewritter;
    }
    
    var array = new Array();
    for (var k in Aj.config.metaRewritter) {
      var def = Aj.config.metaRewritter[k];
      var _priority = null;
      var _fn = null;
      var _key = null;
      var defType = typeof def;
      if (defType === "object") {
        _priority = def.priority;
        _fn = def.fn;
        _key = def.key;
      } else if(defType === "function"){
        _fn = def;
      } else{
        throw "Object or function expected but got:" + defType
              + "\n"
              + JSON.stringify(def);
      }
      
      if(!_priority){
        _priority = 100;
      }
      if(!_fn){
        throw "fn of meta rewritter cannot be empty";
      }
      if(!_key){
        _key = k;
      }
      
      array.push({
        key : _key,
        fn : _fn,
        priority : _priority
      });
    } //end k loop
    //order the array
    array.sort(function (a, b) {
      if (a.priority === b.priority) {
        return a.key.localeCompare(b.key);
      } else {
        return a.priority - b.priority;
      }
    });
    __ordered_metaRewritter = array;
    return __ordered_metaRewritter;
  };
  
  var __uidSeq = 0;
  Aj.util = {
    createUID : function () {
      __uidSeq++;
      return "AJUID-" + __uidSeq;
    },
    regulateArray : function (v, tryKeepRef) {
      if ($.isArray(v)) {
        if(tryKeepRef){
          return v;
        }else{
          return [].concat(v);
        }
      } else if (v === null || v === undefined) {
        return new Array();
      } else {
        return [v];
      }
    },
    clone : function (obj) {
      return clone(obj);
    },
    arraySwap : function (array, index1, index2) {
      var tmp = array[index1];
      array[index1] = array[index2];
      array[index2] = tmp;
    },
  };
  
  var __element_ref_map = {};
  var __getDataRef = function(jqueryObject, dataAttrName){
    var elementRefId = jqueryObject.attr("aj-element-ref-id");
    if(!elementRefId){
      elementRefId = Aj.util.createUID();
      jqueryObject.attr("aj-element-ref-id", elementRefId);
    }
    var refMap = __element_ref_map[elementRefId];
    if(!refMap){
      refMap = {};
      __element_ref_map[elementRefId] = refMap;
    }
    var dataRef = refMap[dataAttrName];
    if(!dataRef){
      dataRef = {
          _trace_id: Aj.util.createUID()
      };
      refMap[dataAttrName] = dataRef;
      Aj.log("create ref:" + dataRef._trace_id + " for " + jqueryObject[0].outerHTML);
    }
    return dataRef;
  };
  
  Aj.init = function(initFunc){
    var scope = Aj.config.scopeCreate();
    initFunc(scope);
  }
  
  //scope
  
  //rewrite all the definition
  var __createAndRetrieveSubMetaRef = function(meta, subType){
    var ref;
    var sub = meta[subType];
    if(Array.isArray(sub)){
      ref = {};
      sub.push(ref);
    }else if (sub){
      var t = typeof sub;
      if(t === "object"){
         meta[subType] = [];
         meta[subType].push(sub);
        ref = sub;
      }else {
        meta[subType] = [];
        meta[subType].push(sub);
        ref = {};
        meta[subType].push(ref);
      }
    }else{
      ref = {};
      meta[subType] = [];
      meta[subType].push(ref);
    }
    return ref;
  };
  var __reverseMetaKeys = ["_meta_type", "_meta_id", "_value", "_prop", "_splice", "_target_path"];
  var __rewriteObserverMeta = function(propertyPath, meta, metaId){
    
    if(Array.isArray(meta)){
      return meta.map(function(m){
        return __rewriteObserverMeta(propertyPath, m, metaId);
      });
    }
    
     //convert function to standard meta format
    var newMeta = Aj.util.clone(meta);
    
    if(typeof newMeta !== "object"){
      newMeta = Aj.config.nonObjectMetaConvertor(newMeta);
    }

    if(newMeta._meta_type){
      //do nothing
    }else{
      newMeta._meta_type = "_root";
    }
    if(!newMeta._meta_id){
      if(metaId){
        newMeta._meta_id = metaId;
      }else{
        newMeta._meta_id = Aj.util.createUID();
      }
    }

    switch(newMeta._meta_type){
      case "_root":
        var subMetas = ["_value", "_prop", "_splice"];
        var subRefs = {
          _value  : __createAndRetrieveSubMetaRef(newMeta, "_value"),
          _prop   : __createAndRetrieveSubMetaRef(newMeta, "_prop"),
          _splice : __createAndRetrieveSubMetaRef(newMeta, "_splice"),
        };
        for(var k in newMeta){
          if(__reverseMetaKeys.indexOf(k) >= 0){
            continue;
          }
          var moveTarget = Aj.config.metaFieldClassifier(k);
          var targetRef = subRefs[moveTarget];
          if(targetRef){
            targetRef[k] = newMeta[k];
            newMeta[k] = null;
            delete newMeta[k];
          }else{
            throw "metaFieldClassifier can only return '_value' or '_prop' or '_splice' rather than '" + moveTarget + "'";
          }
        }
        for(var subIdx in subMetas){
          var subMetak = subMetas[subIdx];
          var subMeta = newMeta[subMetak];
          //make sure meta type is right
          for(var i in subMeta){//must be array due to the __createAndRetrieveSubMetaRef
            var sm = subMeta[i];
            var t = typeof sm;
            if(t === "object"){
              sm._meta_type = subMetak;
            }else {
              subMeta[i] = Aj.config.nonObjectMetaConvertor(subMeta[i]);
              subMeta[i]._meta_type = subMetak;
            }
            subMeta[i]._target_path = propertyPath;
          }
          newMeta[subMetak] = __rewriteObserverMeta(propertyPath, subMeta, newMeta._meta_id);
        }
      break;
      case "_splice":
      case "_value":
        //now we will call the registered meta rewritter to rewrite the meta
        
        __getOrderedMetaRewritter().forEach(function (mr) {
          var m = newMeta[mr.key];
          if (m !== undefined && m !== null) {
            mr.fn(newMeta);
            newMeta[mr.key] = null;
            delete newMeta[mr.key];
          }
        });
        
        if(newMeta._on_change){
          if(!newMeta._register_on_change){
            //by default, we treat the bindContext as scope
            newMeta._register_on_change = function (bindContext, changeHandler) {
              var scope = bindContext;
              var observer = scope.registerPathObserver(this._target_path, function(newValue, oldValue){
                changeHandler(bindContext, newValue, oldValue);
              });
              if(bindContext.addDiscardHook){
                bindContext.addDiscardHook(function(){
                  observer.close();
                })
              }
              return function(){
                var path = Path.get(this._target_path);
                changeHandler(scope, path.getValueFrom(scope), undefined);
              };
            };
          }
        }
        
        if(!newMeta._assign){//set default assign even we do not need it
          newMeta._assign = function (bindContext, value){
            var scope = bindContext;
            var path = Path.get(this._target_path);
            path.setValueFrom(scope, value);
          };
        }
        
        
        //if(meta._assign && !meta._)
      break;
      case "_prop":
        for(var p in newMeta){
          if(__reverseMetaKeys.indexOf(p) >= 0){
            continue;
          }
          newMeta[p] = __rewriteObserverMeta(propertyPath + "." + p, newMeta[p]);
        }
      break;
      default :
        throw "impossible meta type:" + newMeta._meta_type;
    }
    return newMeta;
  };
  var __bindMeta = function(meta, bindContext){
    console.log(meta);
    if(Array.isArray(meta)){
      meta.forEach(function(m){
        __bindMeta(m, bindContext);
      });
      return;
    }
    var nonRecursive = ["_value", "_splice"];
    for(var i in nonRecursive){
      var sub = meta[nonRecursive[i]];
      if(!sub){
        continue;
      }
      sub.forEach(function(sm){
        if(sm._register_on_change){
          var force = sm._register_on_change(bindContext, sm._on_change);
          force.apply();
        }
        if(sm._register_assign){
          var force = sm._register_assign(bindContext, function(){
            sm._assign.apply(sm, arguments);
            Aj.sync();
          });
          //force.apply
        }
      });
    }
    
    var propSub = meta._prop;
    if(!propSub){
      return;
    }
    propSub.forEach(function(ps){
      for(var p in ps){
        var pm = ps[p];
        if(!pm){
          continue;
        }
        __bindMeta(pm, bindContext);
      }
    });
    

  };
  
  var ObserverMap = function(){
    this.map = {};
  };
  
  ObserverMap.prototype.add = function(path, observer){
    var item = {
      prev: null,
      next: null,
      close: function(){
        observer.close();
        if(this.prev){
          this.prev.next = this.next;
        }
        if(this.next){
          this.next.prev = this.prev;
        }
      }
    };
    var head = this.map[path];
    if(!head){
      head = {
        prev: null,
        next: null,
        close: function(){}
      };
      head.prev = head;
      head.next = head;
      this.map[path] = head;
    }
    var tail = head.prev;
    
    tail.next = item;
    
    item.prev = tail;
    item.next = head;
    
    head.prev = item;
    

  }
  
  var Scope = function(){
    this.observerMap = {
      path: new ObserverMap(),
      splice: new ObserverMap()
    };
  };

  Scope.prototype.registerPathObserver = function(path, changeFn){
    var observer = new PathObserver(this, path);
    observer.open(changeFn);
    return this.observerMap.path.add(path, observer);
  };
  
  Scope.prototype.registerArrayObserver = function(path, targetObj, changeFn){
    var observer = new ArrayObserver(targetObj);
    observer.open(changeFn);
    return this.observerMap.path.add(path, observe);
  };

  Scope.prototype.observe = function(varRef, meta, bindContext){
    var refPath = __determineRefPath(this, varRef);
    var rewittenMeta = __rewriteObserverMeta(refPath, meta);
    __bindMeta(rewittenMeta, bindContext ? bindContext : this);
  };
  
  Scope.prototype.snippet = function(selector){
    var root = $(selector);
    return new Snippet(this, root);
  };
  
  
  var Snippet = function(scope, root, parentSnippet, arrayIndex){
    this._scope = scope;
    this._root = root;
    this._parentSnippet = parentSnippet;
    this._index = arrayIndex;
    
    this._subSnippets = [];
    this._discardHooks = [];
    
    if(parentSnippet){
      parentSnippet._subSnippets.push(this);
      if(parentSnippet._indexes){
        this._indexes = Aj.util.clone(parentSnippet._indexes);
      }
    }
    
    if(this._index){
      if(this._indexes){
        this._indexes.push(this._index);
      }
    }

    if(root.length == 0){
      var err = new Error("Snippet was not found for given selector:" + selector);
      console.log(err);
    }
  };
  
  Snippet.prototype.addDiscardHook = function(hook){
    this._discardHooks.push(hook);
  }
  
  Snippet.prototype.discard = function(){
    //_root.remove();
    for(var i=0;i<this._discardHooks.length;i++){
      this._discardHooks[i]();
    }
    for(var i=0;i<this._subSnippets.length;i++){
      this._subSnippets[i].discard();
    }
  };

  Snippet.prototype.bind = function(varRef, meta){
    this._scope.observe(varRef, meta, this);
  };
  
  var __determineRefPath = function (scope, varRef) {
    var searchKey = "ashfdpnasvdnoaisdfn3423#$%$#$%0as8d23nalsfdasdf";
    varRef[searchKey] = 1;

    var refPath = null;
    for (var p in scope) {
      var ref = scope[p];
      if (ref[searchKey] == 1) {
        refPath = p;
        break;
      }
    }

    varRef[searchKey] = null;
    delete varRef[searchKey];

    return refPath;
  };
  
  //export
  window.Aj = Aj;
})();