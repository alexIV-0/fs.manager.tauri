// ⚠️  АВТО-ГЕНЕРАЦИЯ — не редактируй. Источник: jsx/_playground/playground.js
//     dev-скрипт: scaleAvatarByAudio. Пересобирается на yarn jsx:watch / jsx:play.

"object"!=typeof JSON&&(JSON={}),function(){"use strict";var rx_one=/^[\],:{}\s]*$/,rx_two=/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,rx_three=/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,rx_four=/(?:^|:|,)(?:\s*\[)+/g,rx_escapable=/[\\\"\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,rx_dangerous=/[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,gap,indent,meta,rep;function f(t){return t<10?"0"+t:t}function this_value(){return this.valueOf()}function quote(t){return rx_escapable.lastIndex=0,rx_escapable.test(t)?'"'+t.replace(rx_escapable,function(t){var e=meta[t];return"string"==typeof e?e:"\\u"+("0000"+t.charCodeAt(0).toString(16)).slice(-4)})+'"':'"'+t+'"'}function str(t,e){var r,n,o,u,f,a=gap,i=e[t];switch(i&&"object"==typeof i&&"function"==typeof i.toJSON&&(i=i.toJSON(t)),"function"==typeof rep&&(i=rep.call(e,t,i)),typeof i){case"string":return quote(i);case"number":return isFinite(i)?String(i):"null";case"boolean":case"null":return String(i);case"object":if(!i)return"null";if(gap+=indent,f=[],"[object Array]"===Object.prototype.toString.apply(i)){for(u=i.length,r=0;r<u;r+=1)f[r]=str(r,i)||"null";return o=0===f.length?"[]":gap?"[\n"+gap+f.join(",\n"+gap)+"\n"+a+"]":"["+f.join(",")+"]",gap=a,o}if(rep&&"object"==typeof rep)for(u=rep.length,r=0;r<u;r+=1)"string"==typeof rep[r]&&(o=str(n=rep[r],i))&&f.push(quote(n)+(gap?": ":":")+o);else for(n in i)Object.prototype.hasOwnProperty.call(i,n)&&(o=str(n,i))&&f.push(quote(n)+(gap?": ":":")+o);return o=0===f.length?"{}":gap?"{\n"+gap+f.join(",\n"+gap)+"\n"+a+"}":"{"+f.join(",")+"}",gap=a,o}}"function"!=typeof Date.prototype.toJSON&&(Date.prototype.toJSON=function(){return isFinite(this.valueOf())?this.getUTCFullYear()+"-"+f(this.getUTCMonth()+1)+"-"+f(this.getUTCDate())+"T"+f(this.getUTCHours())+":"+f(this.getUTCMinutes())+":"+f(this.getUTCSeconds())+"Z":null},Boolean.prototype.toJSON=this_value,Number.prototype.toJSON=this_value,String.prototype.toJSON=this_value),"function"!=typeof JSON.stringify&&(meta={"\b":"\\b","\t":"\\t","\n":"\\n","\f":"\\f","\r":"\\r",'"':'\\"',"\\":"\\\\"},JSON.stringify=function(t,e,r){var n;if(gap="",indent="","number"==typeof r)for(n=0;n<r;n+=1)indent+=" ";else"string"==typeof r&&(indent=r);if(rep=e,e&&"function"!=typeof e&&("object"!=typeof e||"number"!=typeof e.length))throw new Error("JSON.stringify");return str("",{"":t})}),"function"!=typeof JSON.parse&&(JSON.parse=function(text,reviver){var j;function walk(t,e){var r,n,o=t[e];if(o&&"object"==typeof o)for(r in o)Object.prototype.hasOwnProperty.call(o,r)&&(void 0!==(n=walk(o,r))?o[r]=n:delete o[r]);return reviver.call(t,e,o)}if(text=String(text),rx_dangerous.lastIndex=0,rx_dangerous.test(text)&&(text=text.replace(rx_dangerous,function(t){return"\\u"+("0000"+t.charCodeAt(0).toString(16)).slice(-4)})),rx_one.test(text.replace(rx_two,"@").replace(rx_three,"]").replace(rx_four,"")))return j=eval("("+text+")"),"function"==typeof reviver?walk({"":j},""):j;throw new SyntaxError("JSON.parse")})}();

// jsx/utils/aep/clearRenderQueue.ts
function clearRenderQueue() {
  var renderQueue = app.project.renderQueue;
  if (renderQueue.items.length > 0) {
    while (renderQueue.items.length > 0) {
      renderQueue.items[1].remove();
    }
  }
}

// jsx/utils/aep/closeProject.ts
function closeProject() {
  app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
  app.purge(PurgeTarget.ALL_CACHES);
}

// jsx/utils/fs/path/_core.ts
var CHAR_DOT = 46;
var CHAR_FORWARD_SLASH = 47;
var CHAR_BACKWARD_SLASH = 92;
var CHAR_COLON = 58;
var CHAR_UPPERCASE_A = 65;
var CHAR_UPPERCASE_Z = 90;
var CHAR_LOWERCASE_A = 97;
var CHAR_LOWERCASE_Z = 122;
function isWindowsOS() {
  return ("" + $.os).match(/Windows/) != null;
}
var IS_WIN = isWindowsOS();
var SEP = IS_WIN ? "\\" : "/";
function isSep(code) {
  if (IS_WIN) {
    return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
  }
  return code === CHAR_FORWARD_SLASH;
}
function isWinDeviceRoot(code) {
  return code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z || code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z;
}
function validateString(value, name) {
  if (typeof value !== "string") {
    throw new Error('The "' + name + '" argument must be of type string. Received ' + typeof value);
  }
}
function normalizeString(path, allowAboveRoot) {
  var res = "";
  var lastSegmentLength = 0;
  var lastSlash = -1;
  var dots = 0;
  var code = 0;
  for (var i = 0; i <= path.length; ++i) {
    if (i < path.length) {
      code = path.charCodeAt(i);
    } else if (isSep(code)) {
      break;
    } else {
      code = CHAR_FORWARD_SLASH;
    }
    if (isSep(code)) {
      if (lastSlash === i - 1 || dots === 1) {
      } else if (dots === 2) {
        if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== CHAR_DOT || res.charCodeAt(res.length - 2) !== CHAR_DOT) {
          if (res.length > 2) {
            var lastSlashIndex = res.lastIndexOf(SEP);
            if (lastSlashIndex === -1) {
              res = "";
              lastSegmentLength = 0;
            } else {
              res = res.slice(0, lastSlashIndex);
              lastSegmentLength = res.length - 1 - res.lastIndexOf(SEP);
            }
            lastSlash = i;
            dots = 0;
            continue;
          } else if (res.length !== 0) {
            res = "";
            lastSegmentLength = 0;
            lastSlash = i;
            dots = 0;
            continue;
          }
        }
        if (allowAboveRoot) {
          res += res.length > 0 ? SEP + ".." : "..";
          lastSegmentLength = 2;
        }
      } else {
        if (res.length > 0) {
          res += SEP + path.slice(lastSlash + 1, i);
        } else {
          res = path.slice(lastSlash + 1, i);
        }
        lastSegmentLength = i - lastSlash - 1;
      }
      lastSlash = i;
      dots = 0;
    } else if (code === CHAR_DOT && dots !== -1) {
      ++dots;
    } else {
      dots = -1;
    }
  }
  return res;
}

// jsx/utils/fs/path/basename.ts
function basename(path, suffix) {
  if (suffix !== void 0) {
    validateString(suffix, "suffix");
  }
  validateString(path, "path");
  var start = 0;
  var end = -1;
  var matchedSlash = true;
  var i;
  if (IS_WIN && path.length >= 2 && isWinDeviceRoot(path.charCodeAt(0)) && path.charCodeAt(1) === CHAR_COLON) {
    start = 2;
  }
  if (suffix !== void 0 && suffix.length > 0 && suffix.length <= path.length) {
    if (suffix === path) {
      return "";
    }
    var extIdx = suffix.length - 1;
    var firstNonSlashEnd = -1;
    for (i = path.length - 1; i >= start; --i) {
      var code = path.charCodeAt(i);
      if (isSep(code)) {
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else {
        if (firstNonSlashEnd === -1) {
          matchedSlash = false;
          firstNonSlashEnd = i + 1;
        }
        if (extIdx >= 0) {
          if (code === suffix.charCodeAt(extIdx)) {
            if (--extIdx === -1) {
              end = i;
            }
          } else {
            extIdx = -1;
            end = firstNonSlashEnd;
          }
        }
      }
    }
    if (start === end) {
      end = firstNonSlashEnd;
    } else if (end === -1) {
      end = path.length;
    }
    return path.slice(start, end);
  }
  for (i = path.length - 1; i >= start; --i) {
    if (isSep(path.charCodeAt(i))) {
      if (!matchedSlash) {
        start = i + 1;
        break;
      }
    } else if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
  }
  if (end === -1) {
    return "";
  }
  return path.slice(start, end);
}

// jsx/utils/fs/path/extname.ts
function extname(path) {
  validateString(path, "path");
  var start = 0;
  var startDot = -1;
  var startPart = 0;
  var end = -1;
  var matchedSlash = true;
  var preDotState = 0;
  if (IS_WIN && path.length >= 2 && path.charCodeAt(1) === CHAR_COLON && isWinDeviceRoot(path.charCodeAt(0))) {
    start = startPart = 2;
  }
  for (var i = path.length - 1; i >= start; --i) {
    var code = path.charCodeAt(i);
    if (isSep(code)) {
      if (!matchedSlash) {
        startPart = i + 1;
        break;
      }
      continue;
    }
    if (end === -1) {
      matchedSlash = false;
      end = i + 1;
    }
    if (code === CHAR_DOT) {
      if (startDot === -1) {
        startDot = i;
      } else if (preDotState !== 1) {
        preDotState = 1;
      }
    } else if (startDot !== -1) {
      preDotState = -1;
    }
  }
  if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    return "";
  }
  return path.slice(startDot, end);
}

// jsx/utils/aep/compFromFootage.ts
function compFromFootage(item) {
  return app.project.items.addComp(
    basename(item.name, extname(item.name)),
    item.width,
    item.height,
    item.pixelAspect,
    item.duration,
    item.frameRate
  );
}

// jsx/utils/prototips/addIndexOf.ts
function addIndexOf() {
  Array.prototype.indexOf = function(elem) {
    for (var i = 0; i < this.length; i++) {
      if (this[i] == elem) {
        return i;
      }
    }
    return -1;
  };
}

// jsx/utils/aep/getEffectFromLayer.ts
function getEffectsFromLayer(_layer, _nameArr) {
  if (typeof [].indexOf !== "function") {
    addIndexOf();
  }
  var eff = {};
  var effects = _layer.property("ADBE Effect Parade");
  for (var i = 1; i <= effects.numProperties; i++) {
    var effName = effects.property(i).name;
    var zz = _nameArr.indexOf(effName);
    if (zz != -1) {
      eff[effName] = effects.property(i);
    }
  }
  return eff;
}

// jsx/utils/fs/cleanName.ts
function cleanName(name) {
  var out = "";
  for (var i = 0; i < name.length; i++) {
    var ch = name.charAt(i);
    var code = name.charCodeAt(i);
    if (code >= 55296 && code <= 57343) {
      continue;
    }
    if (ch == " " || ch == "[" || ch == "]" || ch == "(" || ch == ")" || ch == "." || ch == "_" || ch == "-") {
      out += ch;
      continue;
    }
    if (code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122) {
      out += ch;
      continue;
    }
    if (code >= 192) {
      var isSymbol = code >= 8192 && code <= 11263 || // пунктуация, стрелки, мат.символы, значки, дингбаты
      code >= 11776 && code <= 11903 || // дополнительная пунктуация
      code >= 12288 && code <= 12351 || // CJK-символы и пунктуация
      code >= 65024 && code <= 65039 || // variation selectors (модификаторы эмоджи)
      code >= 65520;
      if (!isSymbol) {
        out += ch;
      }
      continue;
    }
  }
  return out;
}

// jsx/utils/aep/tryToImportByName.ts
function tryToImportByName(_path) {
  var folderPath = File(_path).parent;
  var originalName = cleanName(File(_path).displayName);
  var files = Folder(folderPath).getFiles();
  var newF;
  for (var i = 0; i < files.length; i++) {
    var fName = cleanName(files[i].displayName);
    if (fName == originalName) {
      newF = files[i];
      break;
    }
  }
  return newF;
}

// jsx/utils/aep/importFile.ts
function importFile(_path, _type) {
  if (typeof _type == "undefined") {
    _type = "FOOTAGE";
  }
  var newFile;
  var importOptions;
  try {
    importOptions = new ImportOptions(File(_path));
  } catch (e) {
    if (_type == "FOOTAGE") {
      newFile = tryToImportByName(_path);
      importOptions = new ImportOptions(newFile);
    }
  }
  if (importOptions && importOptions.canImportAs(ImportAsType[_type])) {
    newFile = app.project.importFile(importOptions);
    if (_type == "PROJECT") {
      var regEx = new RegExp(".aep");
      for (var i = 1; i <= app.project.rootFolder.numItems; i++) {
        var item = app.project.items[i];
        if (item instanceof FolderItem && regEx.test(item.name)) {
          newFile = item;
          break;
        }
      }
    }
    return newFile;
  } else {
    return false;
  }
}

// jsx/utils/fs/osSep.ts
function osSep() {
  if ($.os.match(/Windows/)) {
    return "\\";
  } else if ($.os.match(/Mac/)) {
    return "/";
  } else {
    return "/";
  }
}

// jsx/utils/fs/path/dirname.ts
function dirname(path) {
  validateString(path, "path");
  var len = path.length;
  if (len === 0) {
    return ".";
  }
  var code = path.charCodeAt(0);
  if (len === 1) {
    return isSep(code) ? path : ".";
  }
  var rootEnd = -1;
  var offset = 0;
  if (IS_WIN && isWinDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
    rootEnd = len > 2 && isSep(path.charCodeAt(2)) ? 3 : 2;
    offset = rootEnd;
  } else if (isSep(code)) {
    rootEnd = offset = 1;
  }
  var end = -1;
  var matchedSlash = true;
  for (var i = len - 1; i >= offset; --i) {
    if (isSep(path.charCodeAt(i))) {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) {
    if (rootEnd === -1) {
      return ".";
    }
    return path.slice(0, rootEnd);
  }
  if (!IS_WIN && rootEnd === 1 && end === 1 && code === CHAR_FORWARD_SLASH) {
    return "//";
  }
  return path.slice(0, end);
}

// jsx/utils/fs/path/normalize.ts
function normalize(path) {
  validateString(path, "path");
  var len = path.length;
  if (len === 0) {
    return ".";
  }
  if (!IS_WIN) {
    var isAbs = path.charCodeAt(0) === CHAR_FORWARD_SLASH;
    var trail = path.charCodeAt(len - 1) === CHAR_FORWARD_SLASH;
    path = normalizeString(path, !isAbs);
    if (path.length === 0) {
      if (isAbs) {
        return "/";
      }
      return trail ? "./" : ".";
    }
    if (trail) {
      path += "/";
    }
    return isAbs ? "/" + path : path;
  }
  var rootEnd = 0;
  var device;
  var isAbsW = false;
  var code = path.charCodeAt(0);
  if (len === 1) {
    return isSep(code) ? "\\" : path;
  }
  if (isWinDeviceRoot(code) && path.charCodeAt(1) === CHAR_COLON) {
    device = path.slice(0, 2);
    rootEnd = 2;
    if (len > 2 && isSep(path.charCodeAt(2))) {
      isAbsW = true;
      rootEnd = 3;
    }
  } else if (isSep(code)) {
    isAbsW = true;
    rootEnd = 1;
  }
  var tail = rootEnd < len ? normalizeString(path.slice(rootEnd), !isAbsW) : "";
  if (tail.length === 0 && !isAbsW) {
    tail = ".";
  }
  if (tail.length > 0 && isSep(path.charCodeAt(len - 1))) {
    tail += "\\";
  }
  if (device === void 0) {
    return isAbsW ? "\\" + tail : tail;
  }
  return isAbsW ? device + "\\" + tail : device + tail;
}

// jsx/utils/fs/path/join.ts
function join() {
  if (arguments.length === 0) {
    return ".";
  }
  var joined;
  for (var i = 0; i < arguments.length; ++i) {
    var arg = arguments[i];
    validateString(arg, "path");
    if (arg.length > 0) {
      if (joined === void 0) {
        joined = arg;
      } else {
        joined += SEP + arg;
      }
    }
  }
  if (joined === void 0) {
    return ".";
  }
  return normalize(joined);
}

// jsx/utils/fs/testFileInFolder.ts
function testFileInFolder(_folder, _name) {
  var ext = extname(_name);
  var base = basename(_name, ext);
  var candidate = _name;
  var numm = 0;
  while (new File(join(_folder, candidate)).exists) {
    numm++;
    candidate = base + "_" + numm + ext;
  }
  return candidate;
}

// jsx/utils/aep/saveProject.ts
function saveProject(_inObj, _addName) {
  var _S = osSep();
  var addName = "";
  if (typeof _addName != "undefined") {
    addName = "-" + _addName;
  }
  var folder = dirname(_inObj.targetPath);
  var extName = extname(_inObj.targetPath);
  var name = basename(_inObj.targetPath, extName) + addName + ".aep";
  var fileName = testFileInFolder(folder, name);
  var newAEP_file = new File(folder + _S + fileName);
  app.project.save(newAEP_file);
  return newAEP_file.fsName;
}

// jsx/dev/scaleAvatarByAudio.ts
function scaleAvatarByAudio() {
  var inObj = {
  "aeInput": {
    "video": [
      "/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/testAE/06.06-11.25/original/easy Jinu.mov"
    ]
  },
  "clearName": "easy Jinu",
  "curItem": "easy Jinu.mov",
  "findTime": "06.06-11.25",
  "localFolder": "/Users/aleksey.ivanov/Desktop/work-local",
  "mainFolderName": "newMainFolder",
  "mainFolderPath": "/Users/aleksey.ivanov/Desktop/newMainFolder",
  "mainWorkFolder": "/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/testAE",
  "pathForDelete": "/Users/aleksey.ivanov/Desktop/newMainFolder/testAE/IN/easy Jinu.mov",
  "projectPathGD": "/Users/aleksey.ivanov/Desktop/newMainFolder/testAE",
  "targetPath": "/Users/aleksey.ivanov/Desktop/work-local/newMainFolder/testAE/06.06-11.25/aeScript easy Jinu.mov",
  "typeOfFile": {
    "aep": [
      "aep"
    ],
    "audio": [
      "mp3",
      "wav"
    ],
    "image": [
      "jpg",
      "jpeg",
      "png",
      "tiff",
      "tga",
      "pdf",
      "gif",
      "pgf"
    ],
    "moho": [
      "moho"
    ],
    "scripts": [
      "js",
      "jsx",
      "lua"
    ],
    "text": [
      "txt",
      "json"
    ],
    "title": [
      "lrc",
      "srt"
    ],
    "video": [
      "avi",
      "mov",
      "mp4",
      "mpeg",
      "mpg",
      "m2v",
      "m4v",
      "ts",
      "mxf"
    ],
    "xlsx": [
      "tsv",
      "csv"
    ]
  },
  "year": "2026"
};
  closeProject();
  var input = inObj.aeInput;
  var _S = osSep();
  var video = importFile(input.video[0]);
  if (!(video instanceof FootageItem)) {
    return false;
  }
  var mainComp = compFromFootage(video);
  var videoLay = mainComp.layers.add(video);
  if (videoLay.audioEnabled == false) {
    videoLay.audioEnabled = true;
  }
  videoLay.solo = true;
  mainComp.openInViewer();
  var command = app.findMenuCommandId("Convert Audio to Keyframes");
  app.executeCommand(command);
  var audioAmp = mainComp.layer(1);
  var audKeyEff = getEffectsFromLayer(audioAmp, ["Both Channels"]);
  var audKey = audKeyEff["Both Channels"]("Slider");
  var pause = 2;
  var addCut = 1;
  var audLevel = 0.3;
  var segments = [];
  var inSpeech = false;
  var speechStart = 0;
  var lastVoiceTime = 0;
  for (var i = 1; i <= audKey.numKeys; i++) {
    var t = audKey.keyTime(i);
    var v = audKey.keyValue(i);
    if (v >= audLevel) {
      if (!inSpeech) {
        speechStart = t;
        inSpeech = true;
      }
      lastVoiceTime = t;
    } else if (inSpeech && t - lastVoiceTime >= pause) {
      segments.push({ start: speechStart, end: lastVoiceTime });
      inSpeech = false;
    }
  }
  if (inSpeech) {
    segments.push({ start: speechStart, end: lastVoiceTime });
  }
  audioAmp.remove();
  videoLay.remove();
  var scaleExpr = "v=0.5;\ns=ease(time, inPoint, inPoint+v, 0,100) + ease(time, outPoint-v, outPoint, 100,0) - 100;\n[s,s]";
  for (var s = 0; s < segments.length; s++) {
    var inPoint = Math.max(0, segments[s].start - addCut);
    var outPoint = Math.min(mainComp.duration, video.duration, segments[s].end + addCut);
    var segLay = mainComp.layers.add(video);
    segLay.inPoint = inPoint;
    segLay.outPoint = outPoint;
    var scaleProp = segLay.property("ADBE Transform Group").property("ADBE Scale");
    scaleProp.expression = scaleExpr;
  }
  var finalFile = [];
  var RQ = app.project.renderQueue;
  clearRenderQueue();
  var fileToRender = RQ.items.add(mainComp);
  fileToRender.outputModule(1).file = File(
    dirname(inObj.targetPath) + _S + basename(inObj.targetPath, extname(inObj.targetPath)) + ".[fileExtension]"
  );
  fileToRender.outputModule(1).applyTemplate("-=QT+alfa=-");
  finalFile.push(fileToRender.outputModule(1).file.fsName);
  saveProject(inObj, "(scale)");
  RQ.render();
  closeProject();
  return finalFile;
}

/* @AE_ENTRY */
try {
    var __res__ = scaleAvatarByAudio();
    $.writeln('=== PLAYGROUND RESULT ===');
    $.writeln(JSON.stringify(__res__));
} catch (e) {
    $.writeln('=== PLAYGROUND ERROR ===');
    $.writeln(e.toString() + (e.line ? ' (line ' + e.line + ')' : ''));
    alert('Playground error: ' + e.toString());
}
