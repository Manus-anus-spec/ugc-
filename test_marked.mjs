import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

// Simulate what Gemini actually returns for a ONE SHOT video
const testMd = `## 5. ACTION BREAKDOWN

| Timestamp | Action | Duration | Hands Doing | Expression/Energy |
|-----------|--------|----------|-------------|-------------------|
| 0:00 - 0:02 | Creator stands facing camera, slight sway | 2s | Both hands at sides, relaxed | Calm, neutral expression |
| 0:02 - 0:05 | Lifts right hand to face, touches cheek | 3s | Right hand moves up to cheekbone | Soft smile, eyes slightly squinted |

## 6. ENERGY & PACING
- **Overall Energy:** Low-medium

## 7. READY-TO-USE PROMPTS

### A. NANO BANANA IMAGE PROMPT (Exact Scene Recreation)
\`\`\`text
Raw iPhone footage aesthetic, 9:16 orientation, camera at eye level.
Ultra-realistic. NOT professional photography.
\`\`\`
Character Count: 612

### B. KLING MOTION PROMPT(S) (Exact Motion Recreation)
\`\`\`
Shot on iPhone front-facing camera, static locked-off camera, no camera movement.
From 0 to 2 seconds: Creator stands centered in frame.
Total duration: 5 seconds.
\`\`\`
Character Count: 820
`;

const html = marked(testMd);
console.log('HAS TABLE:', html.includes('<table>'));
console.log('HAS CODE BLOCK:', html.includes('<pre>'));
console.log('HTML length:', html.length);
const preCount = (html.match(/<pre>/g) || []).length;
const preCloseCount = (html.match(/<\/pre>/g) || []).length;
console.log('pre open:', preCount, 'pre close:', preCloseCount);
console.log('\n=== FULL HTML ===');
console.log(html);
