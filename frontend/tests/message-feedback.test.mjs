import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

function source(relativePath) {
  const absolutePath = path.join(frontendRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Expected frontend file to exist: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

function assertIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    throw new Error(`${message}\nMissing: ${needle}`);
  }
}

function assertNotIncludes(content, needle, message) {
  if (content.includes(needle)) {
    throw new Error(`${message}\nUnexpected: ${needle}`);
  }
}

const bubble = source("components/chat/MessageBubble.tsx");
const list = source("components/chat/MessageList.tsx");
const chat = source("components/chat/ChatInterface.tsx");

assertIncludes(bubble, "onFeedback", "Assistant feedback buttons must call a real persistence handler.");
assertIncludes(bubble, "ThumbsUp", "Helpful feedback should use a recognizable thumbs-up icon.");
assertIncludes(bubble, "ThumbsDown", "Bad feedback should use a recognizable thumbs-down icon.");
assertNotIncludes(bubble, "setGaveFeedback(type);", "Feedback must not be local-only state.");

assertIncludes(list, "onFeedback={onFeedback}", "MessageList must pass the feedback handler into MessageBubble.");
assertIncludes(chat, "/feedback", "ChatInterface must submit feedback to the backend feedback endpoint.");
assertIncludes(chat, "handleMessageFeedback", "ChatInterface must own the feedback submit workflow.");
