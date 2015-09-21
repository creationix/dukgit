"use strict";
return function (bodec) {
  return function (base, delta) {
    var deltaOffset = 0;

    if (base.length !== readLength()) {
      throw new Error("base length mismatch");
    }

    var outLength = readLength();
    var parts = [];
    while (deltaOffset < delta.length) {
      var b = delta[++deltaOffset];

      if (b & 0x80) {
        // Copy command. Tells us offset in base and length to copy.
        var offset = 0;
        var length = 0;
        if (b & 0x01) { offset |= delta[++deltaOffset]; }
        if (b & 0x02) { offset |= delta[++deltaOffset] << 8; }
        if (b & 0x04) { offset |= delta[++deltaOffset] << 16; }
        if (b & 0x08) { offset |= delta[++deltaOffset] << 24; }
        if (b & 0x10) { length |= delta[++deltaOffset]; }
        if (b & 0x20) { length |= delta[++deltaOffset] << 8; }
        if (b & 0x40) { length |= delta[++deltaOffset] << 16; }
        length = length || 0x10000;
        // copy the data
        parts.push(bodec.slice(base, offset, offset + length));
      }
      else if (b > 0) {
        // Insert command, opcode byte is length itself
        parts.push(bodec.slice(delta, deltaOffset, deltaOffset + b));
        deltaOffset += b;
      }
      else {
        throw new Error("Invalid opcode in delta");
      }
    }
    var out = bodec.join(parts);
    if (out.length !== outLength) {
      throw new Error("final size mismatch in delta application");
    }
    return out;

    // Read a variable length number out of delta and move the offset.
    function readLength() {
      deltaOffset++;
      var b = delta[deltaOffset];
      var length = b & 0x7f;
      var shift = 7;
      while (b & 0x80 > 0) {
        deltaOffset++;
        b = delta[deltaOffset];
        length |= (b & 0x7f) << shift;
        shift += 7;
      }
      return length;
    }

  };
};
