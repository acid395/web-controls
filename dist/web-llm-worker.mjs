/*! web-controls widget 0.1.1 - ask any page in plain English, answered by a model running on the visitor's own machine. */
import { WebWorkerMLCEngineHandler } from "./web-llm.js";
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (e) => handler.onmessage(e);
