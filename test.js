"use strict";

var p = require('./modules/utils.js').prettyPrint;
p(uv);

var db = require('./db.js')(
  require('./storage.js')(require('./fs.js')("test.git")),
  require('./codec.js')(require('./bodec.js'))
);
p(db);

var storage = db.storage;
var codec = db.codec;
var modes = codec.modes;

Duktape.Thread.resume(new Duktape.Thread(function () {
  // storage.write("test/path/file", "Hello World\n");
  // storage.put("test/file2", "Good\n");
  // storage.put("test/file2", "Bad");
  // p(storage.read("test/file2").toString());
  // var it, entry;
  // print("nodes");
  // it = storage.nodes("test");
  // while ((entry = it())) { p(entry); }
  // print("leaves");
  // it = storage.leaves("test");
  // while ((entry = it())) { p(entry); }
  // storage.remove("test/path/file");
  // storage.remove("test/file2");
  //
  storage.put("config",
  "[core]\n" +
  	"\trepositoryformatversion = 0\n" +
  	"\tfilemode = true\n" +
  	"\tbare = true\n");
  storage.put("HEAD", "ref: refs/heads/master\n");
  storage.mkdirp("refs");

  p(db.saveAs("tree", [
    { name: "README", mode: modes.blob, hash: db.saveAs("blob", "Hello World\n") },
  ]));
}));
