"use strict";
/*globals -open,-close*/

var p = require('./modules/utils.js').prettyPrint;
/*

Git Object Database
===================

Consumes a storage interface and return a git database interface

db.has(hash) -> bool              - check if db has an object
db.load(hash) -> raw              - load raw data, nil if not found
db.loadAny(hash) -> kind, value   - pre-decode data, error if not found
db.loadAs(kind, hash) -> value    - pre-decode and check type or error
db.save(raw) -> hash              - save pre-encoded and framed data
db.saveAs(kind, value) -> hash    - encode, frame and save to objects/$ha/$sh
db.hashes() -> iter               - Iterate over all hashes

db.getHead() -> hash              - Read the hash via HEAD.
db.updateHead(ref)                - Move head to a given ref.
db.getRef(ref) -> hash            - Read hash of a ref.
db.setRef(ref, hash)              - Write hash to ref.
db.resolve(ref) -> hash           - Resolve hash, tag, branch, or HEAD to hash.
db.nodes(prefix) -> iter          - iterate over non-leaf refs
db.leaves(prefix) -> iter         - iterate over leaf refs
*/

return function (storage, codec) {
  var bodec = codec.bodec;

  var numToType = {
    "1": "commit",
    "2": "tree",
    "3": "blob",
    "4": "tag",
    "6": "ofs-delta",
    "7": "ref-delta",
  };

  var packs = {};

  return {
    init:init,
    storage: storage,
    codec: codec,
    has: has,
    load: load,
    loadAny: loadAny,
    loadAs: loadAs,
    save: save,
    saveAs: saveAs,
    hashes: hashes,
    getHead: getHead,
    updateHead: updateHead,
    getRef: getRef,
    setRef: setRef,
    resolve: resolve,
    nodes: nodes,
    leaves: leaves,
  };

  function hashPath(hash) {
    return "objects/" + hash.substring(0,2) + "/" + hash.substring(2);
  }

  function quoteRegExp(str) {
      return (str+'').replace(/[.?*+^$[\]\\(){}|-]/g, "\\$&");
  }

  function readUint32(buffer, offset) {
    offset = offset || 0;
    if (offset + 4 > buffer.length) {
      throw new Error("Not enough buffer");
    }
    return ((buffer[offset] << 24) |
            (buffer[offset + 1] << 16) |
            (buffer[offset + 2] << 8) |
             buffer[offset + 3]) >>> 0;
  }

  function readUint64(buffer, offset) {
    offset = offset || 0;
    if (offset + 8 > buffer.length) {
      throw new Error("Not enough buffer");
    }
    return readUint32(buffer, offset) * 0x100000000 +
           readUint32(buffer, offset + 4);
  }

  function getPack(packHash) {
    var pack = packs[packHash];
    if (pack) {
      if (Array.isArray(pack)) {
        pack.push(Duktape.Thread.current());
        return Duktape.Thread.yield();
      }
      return pack;
    }
    var waiting = packs[packHash] = [];
    var packFd, indexFd;
    var hashOffset, crcOffset;
    var offsets, lengths;
    // var timer;
    var fs = storage.fs;
    try {

      packFd = fs.open("objects/pack/pack-" + packHash + ".pack");
      var stat = fs.fstat(packFd);
      if (bodec.toRaw(fs.read(packFd, 8, 0)) !== "PACK\0\0\0\2") {
        throw new Error("Only v2 pack files supported");
      }
      var packSize = stat.size;

      indexFd = fs.open("objects/pack/pack-" + packHash + ".idx");
      if (bodec.toRaw(fs.read(indexFd, 8, 0)) !== "ÿtOc\0\0\0\2") {
        throw new Error("Only pack index v2 supported");
      }

      var indexLength = readUint32(fs.read(indexFd, 4, 8 + 255 * 4));

      p({
        packFd: packFd,
        packSize: packSize,
        indexFd: indexFd,
        indexLength: indexLength,
      });

      hashOffset = 8 + 255 * 4 + 4;
      crcOffset = hashOffset + 20 * indexLength;
      var lengthOffset = crcOffset + 4 * indexLength;
      var largeOffset = lengthOffset + 4 * indexLength;
      p({
        hashOffset: hashOffset,
        crcOffset: crcOffset,
        lengthOffset: lengthOffset,
        largeOffset: largeOffset,
      });
      offsets = [];
      lengths = [];
      var sorted = [];
      var data = fs.read(indexFd, 4 * indexLength, lengthOffset);
      var i, offset;
      for (i = 0; i < indexLength; i++) {
        offset = readUint32(data, i * 4 );
        if ((offset & 0x80000000) > 0) {
          // throw new Error("TODO: Implement large offsets properly");
          offset = largeOffset + (offset & 0x7fffffff) * 8;
          offset = readUint64(fs.read(indexFd, 8, offset));
        }
        offsets[i] = offset;
        sorted[i] = offset;
      }
      sorted.sort(function (a, b) {
        return a < b ? -1 : a > b ? 1 : 0;
      });
      for (i = 0; i < indexLength; i++) {
        offset = offsets[i];
        var length;
        for (var j = 0; j < indexLength - 1; j++) {
          if (sorted[j] === offset) {
            length = sorted[j + 1] - offset;
            break;
          }
        }
        lengths[i] = length !== undefined ? length :(packSize - offset - 20);
      }

      p({
        lengths: lengths,
        offsets: offsets,
      });

      // timer = uv.new_timer();
      // uv.unref(timer);
      // uv.timer_start(timer, 2000, 2000, timeout);

    }
    catch (err) {
      close(err);
    }

    pack = packs[packHash] = {
      load: load
    };
    waiting.forEach(function (thread) {
      Duktape.Thread.resume(thread);
    });
    waiting = undefined;

    return pack;

    function close(err) {
      if (packFd) { fs.close(packFd); }
      if (indexFd) { fs.close(indexFd); }
      // if (timer) { uv.close(timer); }
      if (err) {
        if (waiting) {
          waiting.forEach(function (thread) {
            Duktape.Thread.resume(thread, err, true);
          });
        }
        throw err;
      }
    }

    // function timeout() {
    //   return close();
    // }

    function loadHash(hash) {
      // Read first fan-out table to get index into offset table
      var prefix = parseInt(hash.substring(0, 2), 16);
      var first = (prefix === 0) ? 0 :
                  readUint32(fs.read(indexFd, 4, 8 + (prefix - 1) * 4));
      var last = readUint32(fs.read(indexFd, 4, 8 + (prefix) * 4));
      for (var i = first; i < last; i++) {
        var start = hashOffset + i * 20;
        var foundHash = bodec.toHex(fs.read(indexFd, 20, start));
        if (foundHash === hash) {
          return {
            offset: offsets[i],
            length: lengths[i],
          };
        }
      }
    }

    function loadRaw(offset, length) {
      // Shouldn't need more than 32 bytes to read variable length header and
      // optional hash or offset
      var chunk = fs.read(packFd, 32, offset);
      var b = chunk[0];

      // Parse out the git type
      var kind = numToType[(b >> 4) & 0x7];

      // Parse out the uncompressed length
      var size = b & 0xf;
      var left = 4;
      var i = 1;
      while (b & 0x80) {
        b = chunk[i++];
        size |= ((b & 0x7f) << left);
        left += 7;
      }

      // Optionally parse out the hash or offset for deltas
      var ref;
      if (kind === "ref-delta") {
        ref = bodec.toHex(chunk, i, 20);
        i += 20;
      }
      else if (kind === "ofs-delta") {
        b = chunk[i++];
        ref = b & 0x7f;
        while (b & 0x80) {
          b = chunk[i++];
          ref = ((ref + 1) << 7) | (b & 0x7f);
        }
      }

      var compressed = fs.read(packFd, length, offset + i);
      var raw = uv.inflate(compressed, 1);

      if (raw.length !== size) {
        throw new Error("Inflate error or size mismatch at offset " + offset);
      }

      if (kind === "ref-delta") {
        throw new Error("TODO: handle ref-delta");
      }
      else if (kind === "ofs-delta") {
        var base = loadRaw(offset - ref);
        raw = codec.applyDelta(base.body, raw);
        kind = base.type;
      }
      return {
        type: kind,
        body: raw
      };
    }

    function load(hash) {
      var loc = loadHash(hash);
      if (!loc) { return; }
      p(loc);
      var obj = loadRaw(loc.offset, loc.length);
      return codec.frame(obj.type, obj.body);
    }
  }

  function init() {
    updateHead("refs/heads/master");
    storage.put("config",
    "[core]\n" +
      "\trepositoryformatversion = 0\n" +
      "\tfilemode = true\n" +
      "\tbare = true\n" +
    "[gc]\n" +
      "\tauto=0\n");
  }

  function has(hash) {
    // TODO: make a faster hasPack() function
    return !!(storage.read(hashPath(hash)) || loadPack(hash));
  }

  function load(hash) {
    hash = resolve(hash);
    if (!hash) { return; }
    var raw = storage.read(hashPath(hash));
    if (raw) { return uv.inflate(raw, 1); }
    return loadPack(hash);
  }

  function loadPack(hash) {
    var it = storage.leaves("objects/pack");
    var file;
    while ((file = it())) {
      var match = file.match(/^pack.([0-9a-f]{40}).idx$/);
      if (match) {
        var raw = getPack(match[1]).load(hash);
        if (raw) { return raw; }
      }
    }
  }

  function loadAny(hash) {
    var raw = load(hash);
    if (!raw) { return; }
    return codec.deframe(raw, true);
  }

  function loadAs(kind, hash) {
    var obj = loadAny(hash);
    if (!obj) { return; }
    if (obj.type !== kind) { throw new Error("Type mismatch " + hash); }
    return obj.body;
  }

  function save(raw) {
    var hash = codec.sha1(raw);
    // 0x1000 = TDEFL_WRITE_ZLIB_HEADER
    // 4095 = Huffman+LZ (slowest/best compression)
    storage.put(hashPath(hash), uv.deflate(raw, 0x1000 + 4095));
    return hash;
  }

  function saveAs(kind, value) {
    return save(codec.frame(kind, value));
  }

  function hashes() {

  }

  function getHead() {
    var head = bodec.toUnicode(storage.read("HEAD"));
    return head.match(/ref: +([^\n]+)/)[1];
  }

  function updateHead(ref) {
    return storage.write("HEAD", "ref: " + ref + "\n");
  }

  function getRef(ref) {
    var value, match;
    value = storage.read(ref);
    if (value) {
      match = bodec.toUnicode(value).match(/[0-9a-f]{40}/);
      if (match) { return match[0]; }
    }
    value = storage.read("packed-refs");
    if (!value) { return;}
    // TODO: escape ref as literal regular expression value.
    match = bodec.toUnicode(value).match(
      new RegExp("([0-9a-f]{40}) " + quoteRegExp(ref)));
    if (match) { return match[1]; }
  }

  function setRef(ref, hash) {
    return storage.write(ref, hash + "\n");
  }

  function resolve(ref) {
    if (ref === "HEAD") { ref = getHead(); }
    if (/^[0-9a-f]{40}$/.test(ref)) { return ref; }
    // TODO: also try prepending "refs/tags" and "refs/branches" to query.
    return getRef(ref);
  }

  function nodes(prefix) {

  }

  function leaves(prefix) {

  }

};
//
//
//
//
//
//
//
//   function db.hashes()
//     local groups = storage.nodes("objects")
//     local prefix, iter
//     return function ()
//       while true do
//         if prefix then
//           local rest = iter()
//           if rest then return prefix .. rest end
//           prefix = nil
//           iter = nil
//         end
//         prefix = groups()
//         if not prefix then return end
//         iter = storage.leaves("objects/" .. prefix)
//       end
//     end
//   end
//
//
//   function db.resolve(ref)
//     if ref == "HEAD" then return db.getHead() end
//     local hash = ref:match("^%x+$")
//     if hash and #hash == 40 then return hash end
//     return db.getRef(ref)
//         or db.getRef("refs/heads/" .. ref)
//         or db.getRef("refs/tags/" .. ref)
//   end
//
//   local function makePackedIter(prefix, inner)
//     local packed = storage.read("packed-refs")
//     if not packed then return function () end end
//     if prefix:byte(-1) ~= 47 then
//       prefix = prefix .. "/"
//     end
//     if inner then
//       return packed:gmatch(escape(prefix) .. "([^/ \r\n]+)/")
//     else
//       return packed:gmatch(escape(prefix) .. "([^/ \r\n]+)")
//     end
//   end
//
//   local function commonIter(iter1, iter2)
//     local seen = {}
//     return function ()
//       if iter1 then
//         local item =iter1()
//         if item then
//           seen[item] = true
//           return item
//         end
//         iter1 = nil
//       end
//       while true do
//         local item = iter2()
//         if not item then return end
//         if not seen[item] then
//           seen[item] = true
//           return item
//         end
//       end
//     end
//   end
//
//   function db.nodes(prefix)
//     return commonIter(
//       storage.nodes(prefix),
//       makePackedIter(prefix, true)
//     )
//   end
//
//   function db.leaves(prefix)
//     return commonIter(
//       storage.leaves(prefix),
//       makePackedIter(prefix, false)
//     )
//   end
//
//   return db
// end
