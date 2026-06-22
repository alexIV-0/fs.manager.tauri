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

// jsx/utils/aep/manyImportFile.ts
function manyImportFile(_arr) {
  var filesArr = [];
  var problemsArr = [];
  for (var i = 0; i < _arr.length; i++) {
    var item = _arr[i];
    var curFile = importFile(item, "FOOTAGE");
    if (!curFile) {
      problemsArr.push("coud not import file: " + item.path);
      continue;
    }
    filesArr.push(curFile);
  }
  return { files: filesArr, problems: problemsArr };
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

// jsx/utils/aep/scaleCurLayer.ts
function scaleCurLayer(_layer, _scale, _size) {
  if (typeof _scale == "undefined") {
    return 0;
  }
  _scale = !isNaN(Number(_scale)) ? Number(_scale) : _scale;
  var newScale = 100;
  switch (typeof _scale) {
    case "string":
      var size = {
        width: _layer.containingComp.width,
        height: _layer.containingComp.height
      };
      if (typeof _size != "undefined") {
        size.width = _size[0];
        size.height = _size[1];
      }
      if (_scale == "fit" || _scale == "fill") {
        var sWidth = size.width / _layer.width * 100;
        var sHight = size.height / _layer.height * 100;
        var testW = sHight * _layer.width / 100;
        if (_scale == "fit") {
          newScale = Math.min(sWidth, sHight);
        } else if (_scale == "fill") {
          newScale = Math.max(sWidth, sHight);
        }
      } else {
        newScale = size[_scale.toLowerCase()] / _layer[_scale.toLowerCase()] * 100;
      }
      break;
    case "number":
      newScale = _layer.containingComp.height * _scale / _layer.width;
      break;
  }
  _layer.transform.scale.setValue([newScale, newScale]);
  return newScale;
}

// jsx/utils/prototips/isArray.ts
function isArray(element) {
  return element instanceof Array;
}

// jsx/utils/randomGen/getRandomInt.ts
function getRandomInt(min, max) {
  if (typeof max == "undefined") {
    max = min;
    min = 0;
  }
  if (max < min) {
    var temp = max;
    max = min;
    min = temp;
  }
  if (min === max) {
    return min;
  }
  var randNum = Math.floor(Math.random() * (max - min + 1)) + min;
  return randNum;
}

// jsx/utils/randomGen/getDurationInSecconds.ts
function getDurationInSecconds(rand, fps) {
  var minVal = 0;
  var maxVal = 0;
  if (isArray(rand)) {
    if (rand.length === 1) {
      minVal = 0;
      maxVal = rand[0];
    } else if (rand.length >= 2) {
      minVal = rand[0];
      maxVal = rand[1];
    }
  } else {
    minVal = 0;
    maxVal = rand;
  }
  if (maxVal < minVal) {
    var tmp = maxVal;
    maxVal = minVal;
    minVal = tmp;
  }
  if (minVal === maxVal) {
    return minVal;
  }
  var minFrame = minVal * fps;
  var maxFrame = maxVal * fps;
  var randNum = getRandomInt(minFrame, maxFrame);
  var sec = randNum / fps;
  return sec;
}

// jsx/dev/robloxSplitScreen.ts
function robloxSplitScreen() {
  var inObj = {};
  var input = inObj.aeInput;
  var _S = osSep();
  closeProject();
  var video = importFile(input.video[0]);
  if (!(video instanceof FootageItem)) {
    return false;
  }
  var fps = 25;
  var compW = 1080;
  var compH = 960;
  var mainCompDuration = getDurationInSecconds(input.compDuration, fps);
  var mainComp = app.project.items.addComp("mainComp", compW, 1920, 1, mainCompDuration, fps);
  var memComp = app.project.items.addComp("memComp", compW, compH, 1, mainCompDuration, fps);
  var videoComp = app.project.items.addComp("videoComp", compW, compH, 1, mainCompDuration, fps);
  var video = importFile(input.video[0]);
  var memVid = manyImportFile(input.mems).files;
  var statBGvid = manyImportFile(input.statBG).files;
  setVideoToComp([video], 20, videoComp);
  setVideoToComp(statBGvid, 0, memComp, memVid);
  var videoCompLay = mainComp.layers.add(videoComp);
  if (videoCompLay.hasAudio) {
    videoCompLay.audioEnabled = false;
  }
  var memCompLay = mainComp.layers.add(memComp);
  if (memCompLay.hasAudio) {
    memCompLay.audioEnabled = false;
  }
  var randPos = getRandomInt(100);
  if (randPos > 50) {
    videoCompLay.transform.position.setValue([compW / 2, compH / 2]);
    memCompLay.transform.position.setValue([compW / 2, mainComp.height - compH / 2]);
  } else {
    memCompLay.transform.position.setValue([compW / 2, compH / 2]);
    videoCompLay.transform.position.setValue([compW / 2, mainComp.height - compH / 2]);
  }
  var finalFile = [];
  var RQ = app.project.renderQueue;
  clearRenderQueue();
  var fileToRender = RQ.items.add(mainComp);
  fileToRender.outputModule(1).file = File(
    dirname(inObj.targetPath) + _S + basename(inObj.targetPath, extname(inObj.targetPath)) + ".[fileExtension]"
  );
  finalFile.push(fileToRender.outputModule(1).file.fsName);
  saveProject(inObj, "(roblox)");
  RQ.render();
  closeProject();
  return finalFile;
  function setVideoToComp(_video, _offset, _comp, _mems) {
    var prevTime = 0;
    while (prevTime < _comp.duration) {
      var randDur = getDurationInSecconds(input.randScenes, _comp.frameRate);
      if (_comp.duration - (prevTime + randDur) < 1) {
        randDur = _comp.duration - prevTime;
      }
      var video2 = _video[getRandomInt(_video.length - 1)];
      var vidLay = _comp.layers.add(video2);
      var startTimeForVid = getDurationInSecconds([_offset, video2.duration - _offset - randDur], _comp.frameRate);
      vidLay.inPoint = startTimeForVid;
      vidLay.outPoint = startTimeForVid + randDur;
      vidLay.startTime = prevTime - startTimeForVid;
      scaleCurLayer(vidLay, "fill");
      if (typeof _mems != "undefined") {
        var mems = _mems[getRandomInt(_mems.length - 1)];
        var memsLay = _comp.layers.add(mems);
        var startTimeForVid = getDurationInSecconds(mems.duration - randDur, _comp.frameRate);
        memsLay.inPoint = startTimeForVid;
        memsLay.outPoint = startTimeForVid + randDur;
        memsLay.startTime = prevTime - startTimeForVid;
        var randScale = getRandomInt(_comp.height, _comp.height / 1.3);
        var newScale = scaleCurLayer(memsLay, "fit", [randScale, randScale]);
        var newH = mems.height * newScale / 100 / 2;
        var newW = mems.width * newScale / 100 / 2;
        var posX = getRandomInt(newW, _comp.width - newW);
        var posY = getRandomInt(newH, _comp.height - newH);
        memsLay.transform.position.setValue([posX, posY]);
      }
      prevTime += randDur;
    }
  }
}

/* @AE_ENTRY */
robloxSplitScreen();
