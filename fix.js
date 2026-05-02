const fs = require('fs');

// Fix Button.tsx
let btn = fs.readFileSync('frontend/components/ui/Button.tsx', 'utf-8');
btn = btn.replace('disabled?: boolean;', 'disabled?: boolean;\n  fullWidth?: boolean;');
btn = btn.replace('isDisabled && "opacity-60 cursor-not-allowed",', 'isDisabled && "opacity-60 cursor-not-allowed",\n          fullWidth && "w-full",');
fs.writeFileSync('frontend/components/ui/Button.tsx', btn);

// Fix Input.tsx
let inp = fs.readFileSync('frontend/components/ui/Input.tsx', 'utf-8');
inp = inp.replace('error?: string;', 'error?: string;\n  label?: string;');
inp = inp.replace('<div className="w-full">', '<div className="w-full">\n        {label && <label className="block text-sm font-medium text-gray-300 mb-2">{label}</label>}');
fs.writeFileSync('frontend/components/ui/Input.tsx', inp);

// Fix MessageBubble.tsx
let mb = fs.readFileSync('frontend/components/chat/MessageBubble.tsx', 'utf-8');
mb = mb.replace('interface MessageBubbleProps', 'export interface ChatMessage { id: string; role: "user" | "ai"; content: string; timestamp?: string; }\n\ninterface MessageBubbleProps');
fs.writeFileSync('frontend/components/chat/MessageBubble.tsx', mb);

// Fix VerifyForm.tsx
let vf = fs.readFileSync('frontend/components/auth/VerifyForm.tsx', 'utf-8');
vf = vf.replace('<OTPInput value={code} onChange={setCode} disabled={loading} />', '<OTPInput length={6} onComplete={setCode} disabled={loading} />');
fs.writeFileSync('frontend/components/auth/VerifyForm.tsx', vf);

// Fix ChatInterface.tsx
let ci = fs.readFileSync('frontend/components/chat/ChatInterface.tsx', 'utf-8');
ci = ci.replace('<MessageList messages={messages} loading={loading} />', '<MessageList messages={messages} isTyping={loading} />');
ci = ci.replace('<ChatInput onSend={sendMessage} loading={loading} />', '<ChatInput onSend={sendMessage} disabled={loading} />');
fs.writeFileSync('frontend/components/chat/ChatInterface.tsx', ci);

console.log("Fixes applied.");
