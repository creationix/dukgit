/*jshint bitwise:false,strict:false*/
var modes = {
  tree:   040000,
  blob:   0100644,
  file:   0100644,
  exec:   0100755,
  sym:    0120000,
  commit: 0160000,
  isBlob: function (mode) {
    return mode & 0140000 === 0100000;
  },
  isFile: function (mode) {
    return mode & 0160000 === 0100000;
  },
  toType: function (mode) {
    return mode === 0160000 ? "commit"
         : mode === 040000 ? "tree"
         : mode & 0140000 === 0100000 ? "blob" :
           "unknown";
  },
};

return function (bodec) {
  "use strict";

  // (body) -> raw-buffer
  var encoders = {
    blob: encodeBlob,
    tree: encodeTree,
    commit: encodeCommit,
    tag: encodeTag,
  };

  // (raw-buffer) -> body
  var decoders = {
    blob: decodeBlob,
    tree: decodeTree,
    commit: decodeCommit,
    tag: decodeTag,
  };

  // Shared buffer for non-streaming sha1 calculations
  var shared = bodec.create(80);

  return {
    bodec: bodec,
    modes: modes,
    sha1: sha1,
    safe: safe,
    // ({type:type, body:raw-buffer}) -> buffer
    frame: frame,
    // (buffer) -> {type:type, body:raw-buffer}
    deframe: deframe,
    treeSort: treeSort,
    treeMap: treeMap,
    encoders: encoders,
    decoders: decoders,
  };

  // Input chunks must be either arrays of bytes or "raw" encoded strings
  function sha1(buffer) {
    if (buffer === undefined) { return create(false); }
    var shasum = create(true);
    shasum.update(buffer);
    return shasum.digest();
  }

  // A pure JS implementation of sha1 for non-node environments.
  function create(sync) {
    var h0 = 0x67452301;
    var h1 = 0xEFCDAB89;
    var h2 = 0x98BADCFE;
    var h3 = 0x10325476;
    var h4 = 0xC3D2E1F0;
    // The first 64 bytes (16 words) is the data chunk
    var block, offset = 0, shift = 24;
    var totalLength = 0;
    if (sync) { block = shared; }
    else { block = bodec.create(80); }

    return { update: update, digest: digest };

    // The user gave us more data.  Store it!
    function update(chunk) {
      if (typeof chunk === "string") { return updateString(chunk); }
      var length = chunk.length;
      totalLength += length * 8;
      for (var i = 0; i < length; i++) {
        write(chunk[i]);
      }
    }

    function updateString(string) {
      var length = string.length;
      totalLength += length * 8;
      for (var i = 0; i < length; i++) {
        write(string.charCodeAt(i));
      }
    }

    function write(byte) {
      block[offset] |= (byte & 0xff) << shift;
      if (shift) {
        shift -= 8;
      }
      else {
        offset++;
        shift = 24;
      }
      if (offset === 16) { processBlock(); }
    }

    // No more data will come, pad the block, process and return the result.
    function digest() {
      // Pad
      write(0x80);
      if (offset > 14 || (offset === 14 && shift < 24)) {
        processBlock();
      }
      offset = 14;
      shift = 24;

      // 64-bit length big-endian
      write(0x00); // numbers this big aren't accurate in javascript anyway
      write(0x00); // ..So just hard-code to zero.
      write(totalLength > 0xffffffffff ? totalLength / 0x10000000000 : 0x00);
      write(totalLength > 0xffffffff ? totalLength / 0x100000000 : 0x00);
      for (var s = 24; s >= 0; s -= 8) {
        write(totalLength >> s);
      }

      // At this point one last processBlock() should trigger and we can pull out the result.
      return toHex(h0) +
             toHex(h1) +
             toHex(h2) +
             toHex(h3) +
             toHex(h4);
    }

    // We have a full block to process.  Let's do it!
    function processBlock() {
      // Extend the sixteen 32-bit words into eighty 32-bit words:
      for (var i = 16; i < 80; i++) {
        var w = block[i - 3] ^ block[i - 8] ^ block[i - 14] ^ block[i - 16];
        block[i] = (w << 1) | (w >>> 31);
      }

      // log(block);

      // Initialize hash value for this chunk:
      var a = h0;
      var b = h1;
      var c = h2;
      var d = h3;
      var e = h4;
      var f, k;

      // Main loop:
      for (i = 0; i < 80; i++) {
        if (i < 20) {
          f = d ^ (b & (c ^ d));
          k = 0x5A827999;
        }
        else if (i < 40) {
          f = b ^ c ^ d;
          k = 0x6ED9EBA1;
        }
        else if (i < 60) {
          f = (b & c) | (d & (b | c));
          k = 0x8F1BBCDC;
        }
        else {
          f = b ^ c ^ d;
          k = 0xCA62C1D6;
        }
        var temp = (a << 5 | a >>> 27) + f + e + k + (block[i]|0);
        e = d;
        d = c;
        c = (b << 30 | b >>> 2);
        b = a;
        a = temp;
      }

      // Add this chunk's hash to result so far:
      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;

      // The block is now reusable.
      offset = 0;
      for (i = 0; i < 16; i++) {
        block[i] = 0;
      }
    }

    function toHex(word) {
      var hex = "";
      for (var i = 28; i >= 0; i -= 4) {
        hex += ((word >> i) & 0xf).toString(16);
      }
      return hex;
    }
  }

  function treeSort(a, b) {
    var aa = (a.mode === modes.tree) ? a.name + "/" : a.name;
    var bb = (b.mode === modes.tree) ? b.name + "/" : b.name;
    return aa > bb ? 1 : aa < bb ? -1 : 0;
  }


  // Remove illegal characters in things like emails and names
  function safe(string) {
    return string.replace(/(?:^[\.,:;<>"']+|[\0\n<>]+|[\.,:;<>"']+$)/gm, "");
  }

  function encodeBlob(body) {
    if (typeof body === "string") {
      body = bodec.fromUnicode(body);
    }
    if (!bodec.isBinary(body)) {
      throw new TypeError("Blobs must be binary values");
    }
    return body;
  }

  function treeMap(key) {
    /*jshint validthis:true*/
    var entry = this[key];
    return {
      name: key,
      mode: entry.mode,
      hash: entry.hash
    };
  }

  function encodeTree(body) {
    var tree = "";
    if (!Array.isArray(body)) {
      throw new TypeError("Tree must be in array form");
    }
    body.sort(treeSort);
    for (var i = 0, l = body.length; i < l; i++) {
      var entry = body[i];
      tree += entry.mode.toString(8) + " " + bodec.encodeUtf8(entry.name) +
              "\0" + bodec.decodeHex(entry.hash);
    }
    return bodec.fromRaw(tree);
  }

  function encodeTag(body) {
    var str = "object " + body.object +
      "\ntype " + body.type +
      "\ntag " + body.tag +
      "\ntagger " + formatPerson(body.tagger) +
      "\n\n" + body.message;
    return bodec.fromUnicode(str);
  }

  function encodeCommit(body) {
    var str = "tree " + body.tree;
    for (var i = 0, l = body.parents.length; i < l; ++i) {
      str += "\nparent " + body.parents[i];
    }
    str += "\nauthor " + formatPerson(body.author) +
           "\ncommitter " + formatPerson(body.committer) +
           "\n\n" + body.message;
    return bodec.fromUnicode(str);
  }


  function formatPerson(person) {
    return safe(person.name) +
      " <" + safe(person.email) + "> " +
      formatDate(person.date);
  }

  function two(num) {
    return (num < 10 ? "0" : "") + num;
  }

  function formatDate(date) {
    var seconds, offset;
    if (date.seconds) {
      seconds = date.seconds;
      offset = date.offset;
    }
    // Also accept Date instances
    else {
      seconds = Math.floor(date.getTime() / 1000);
      offset = date.getTimezoneOffset();
    }
    var neg = "+";
    if (offset <= 0) { offset = -offset; }
    else { neg = "-"; }
    offset = neg + two(Math.floor(offset / 60)) + two(offset % 60);
    return seconds + " " + offset;
  }

  function frame(type, body) {
    if (!bodec.isBinary(body)) { body = encoders[type](body); }
    return bodec.join([
      bodec.fromRaw(type + " " + body.length + "\0"),
      body
    ]);
  }

  function decodeBlob(body) {
    return body;
  }

  function decodeTree(body) {
    var i = 0;
    var length = body.length;
    var start;
    var mode;
    var name;
    var hash;
    var tree = [];
    while (i < length) {
      start = i;
      i = indexOf(body, 0x20, start);
      if (i < 0) { throw new SyntaxError("Missing space"); }
      mode = parseOct(body, start, i++);
      start = i;
      i = indexOf(body, 0x00, start);
      name = bodec.toUnicode(body, start, i++);
      hash = bodec.toHex(body, i, i += 20);
      tree.push({
        name: name,
        mode: mode,
        hash: hash
      });
    }
    return tree;
  }

  function decodeCommit(body) {
    var i = 0;
    var start;
    var key;
    var parents = [];
    var commit = {
      tree: "",
      parents: parents,
      author: "",
      committer: "",
      message: ""
    };
    while (body[i] !== 0x0a) {
      start = i;
      i = indexOf(body, 0x20, start);
      if (i < 0) { throw new SyntaxError("Missing space"); }
      key = bodec.toRaw(body, start, i++);
      start = i;
      i = indexOf(body, 0x0a, start);
      if (i < 0) { throw new SyntaxError("Missing linefeed"); }
      var value = bodec.toUnicode(body, start, i++);
      if (key === "parent") {
        parents.push(value);
      }
      else {
        if (key === "author" || key === "committer") {
          value = decodePerson(value);
        }
        commit[key] = value;
      }
    }
    i++;
    commit.message = bodec.toUnicode(body, i, body.length);
    return commit;
  }

  function decodeTag(body) {
    var i = 0;
    var start;
    var key;
    var tag = {};
    while (body[i] !== 0x0a) {
      start = i;
      i = indexOf(body, 0x20, start);
      if (i < 0) { throw new SyntaxError("Missing space"); }
      key = bodec.toRaw(body, start, i++);
      start = i;
      i = indexOf(body, 0x0a, start);
      if (i < 0) { throw new SyntaxError("Missing linefeed"); }
      var value = bodec.toUnicode(body, start, i++);
      if (key === "tagger") { value = decodePerson(value); }
      tag[key] = value;
    }
    i++;
    tag.message = bodec.toUnicode(body, i, body.length);
    return tag;
  }

  function decodePerson(string) {
    var match = string.match(/^([^<]*) <([^>]*)> ([^ ]*) (.*)$/);
    if (!match) { throw new Error("Improperly formatted person string"); }
    return {
      name: match[1],
      email: match[2],
      date: {
        seconds: parseInt(match[3], 10),
        offset: parseInt(match[4], 10) / 100 * -60
      }
    };
  }

  function deframe(buffer, decode) {
    var space = indexOf(buffer, 0x20);
    if (space < 0) { throw new Error("Invalid git object buffer"); }
    var nil = indexOf(buffer, 0x00, space);
    if (nil < 0) { throw new Error("Invalid git object buffer"); }
    var body = bodec.slice(buffer, nil + 1);
    var size = parseDec(buffer, space + 1, nil);
    if (size !== body.length) { throw new Error("Invalid body length."); }
    var type = bodec.toRaw(buffer, 0, space);
    return {
      type: type,
      body: decode ? decoders[type](body) : body
    };
  }

  function indexOf(buffer, byte, i) {
    i |= 0;
    var length = buffer.length;
    for (;;i++) {
      if (i >= length) { return -1; }
      if (buffer[i] === byte) { return i; }
    }
  }

  function parseOct(buffer, start, end) {
    var val = 0;
    while (start < end) {
      val = (val << 3) + buffer[start++] - 0x30;
    }
    return val;
  }

  function parseDec(buffer, start, end) {
    var val = 0;
    while (start < end) {
      val = val * 10 + buffer[start++] - 0x30;
    }
    return val;
  }
};
