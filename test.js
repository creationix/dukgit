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

var bodec = require('./bodec.js');
var git = require('./core.js')(bodec);
var modes = git.modes;
p(git);

var data = git.frame({
  type: "tree",
  body: [
    { name: "index.html", mode: modes.blob, hash: "80b38a9171a9c61ac590e3867f56322027240e7e" },
  ]
});
p(data);
p(git.deframe(data, true));
