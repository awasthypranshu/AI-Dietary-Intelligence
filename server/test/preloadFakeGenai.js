// Used only for the end-to-end test: swaps the real @google/genai package
// for the fake client so the real server can run without an API key.
const Module = require("module");
const { createFakeGemini } = require("./fakeGemini");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@google/genai") {
    return { GoogleGenAI: function () { return createFakeGemini(); } };
  }
  return originalLoad.call(this, request, parent, isMain);
};