"use strict";

var p = require('./modules/utils.js').prettyPrint;

var fs = require('./fs.js')();
var storage = require('./storage.js')(fs);
p(storage);


Duktape.Thread.resume(new Duktape.Thread(function () {
  storage.write("test/path/file", "Hello World\n");
  storage.put("test/file2", "Good\n");
  storage.put("test/file2", "Bad");
  p(storage.read("test/file2").toString());
  var it, entry;
  print("nodes");
  it = storage.nodes("test");
  while ((entry = it())) { p(entry); }
  print("leaves");
  it = storage.leaves("test");
  while ((entry = it())) { p(entry); }
  storage.remove("test/path/file");
  storage.remove("test/file2");
}));
