"use strict";

var p = require('./modules/utils.js').prettyPrint;

var db = require('./db.js')(
  require('./storage.js')(require('./fs.js')()),
  require('./codec.js')(require('./bodec.js'))
);
p(db);
var storage = db.storage;
var codec = db.codec;
var modes = codec.modes;

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

  var data = codec.frame({
    type: "tree",
    body: [
      { name: "index.html", mode: modes.blob, hash: "80b38a9171a9c61ac590e3867f56322027240e7e" },
    ]
  });
  p(data);
  p(codec.deframe(data, true));

  p(codec.sha1(""));
}));
