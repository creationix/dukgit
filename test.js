"use strict";

var p = require('./modules/utils.js').prettyPrint;
p(uv);

var codec = require('./codec.js')(require('./bodec.js'));
var makeDb = require('./db.js');
var makeStorage =require('./storage.js');
var makeFs = require('./fs.js');
function mount(path) {
  return makeDb(makeStorage(makeFs(path)), codec);
}
var db = mount("test.git");

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

  db.init();

  var tim = {
    name: "Tim Caswell",
    email: "tim@creationix.com",
    date: { // Fri Sep 18 22:52:35 2015 -0500
      seconds: 1442634755,
      offset: 300, // CDT
    }
  };
  db.setRef("refs/heads/master", db.saveAs("commit", {
    parents: [],
    tree: db.saveAs("tree", [
      { name: "README",
        mode: modes.blob,
        hash: db.saveAs("blob", "Hello World\n") },
    ]),
    committer: tim,
    author: tim,
    message: "Test commit\n",
  }));

  db = mount(".git");
  p(db.loadAs("commit", "HEAD"));
}));
