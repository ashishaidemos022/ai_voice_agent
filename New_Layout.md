

VIAANA AI — Portal Layout UI/UX Improvement Guide

Modern Web App & AI Workspace Design Recommendations

⸻

🎯 Goals
	•	Move from tool dashboard → agent control workspace
	•	Improve hierarchy, clarity, and flow
	•	Reduce visual noise
	•	Create a modern, premium AI platform experience
	•	Support scaling to more features & agents

The UI should feel:

“I am operating an AI system”
—not—
“I am configuring developer widgets”

⸻

✅ High-Level Recommendations

✔ Emphasize the Agent Workspace (center)

Current UI distributes attention equally.

Modern design patterns prioritize:
	•	Center = Agent runtime & interaction
	•	Right = Secondary controls / status
	•	Left = Navigation & agent objects

This matches:
	•	OpenAI Console
	•	Replit Agents
	•	Notion AI
	•	Runway ML

⸻

1️⃣ Improve Layout Hierarchy

Current Issue
	•	Sidebar, workspace, and right panel all compete visually
	•	Tools drawer feels crowded
	•	Embed editor overlaps runtime context
	•	Workspace lacks visual priority

Recommended Approach

Adopt a 3-zone structure:

Left   = Navigation + Agent entities
Center = Agent runtime / interaction
Right  = Controls / RAG / Theme / Embed

Make center panel the hero.

Right panel = secondary contextual utilities.

⸻

2️⃣ Improve Tools List Readability & Scannability

Current Issues
	•	Tool names look like exported function identifiers
	•	Long snake-case strings wrap poorly
	•	No distinction between tool types
	•	Descriptions are dense + hard to skim

Recommended Improvements

✔ Use friendly display names
Instead of:

Call_RAG_AI_Agent_Ashish_

Use:

RAG — Banking Policy Lookup

Show internal name only in details view.

⸻

✔ Group tools by category
Sections:
	•	MCP Tools
	•	Automations
	•	Knowledge / RAG
	•	System Utilities

Each group should include:
	•	label chip
	•	count badge
	•	collapsible container

⸻

✔ Increase row spacing for comfort
Recommended touch zone:

40–44px height per row

Improves:
	•	scannability
	•	touch accuracy
	•	cognitive load

⸻

3️⃣ Make Active Agent Context Clearer

Current Issues
	•	Active preset label blends into page text
	•	“Current preset” is visually weak
	•	Screen does not reinforce which agent is live

Recommended Changes

Convert active preset into a context header chip:

Active Agent
[ Concierge — Evolve Med Spa ]

Include:
	•	agent type icon (voice / chat)
	•	environment tag
	•	color-coded status state

This ensures the user always knows:
	•	who is running
	•	what they’re controlling
	•	where actions apply

⸻

4️⃣ Improve Realtime Voice Agent Panel UX

Current Issues
	•	Mic state + agent state appear fused
	•	Status messaging is dense
	•	Tap-to-speak interaction lacks separation

Recommended Layout

Left side
	•	Agent State
	•	Status explanation
	•	Turn awareness indicator

Right side
	•	Mic
	•	Model
	•	Stream metadata

⸻

✔ Add subtle ambient idle motion
Not flashy — just enough to feel:
	•	alive
	•	ready
	•	responsive

⸻

✔ Provide micro-feedback during speech
Ex:
	•	waveform shimmer
	•	small “Listening…” caption

Avoid:
	•	loud / bouncing bars
	•	distracting animation

⸻

5️⃣ Move Embed + Theme Customizer Into Its Own Context

Current Issue

Embed editor lives inside runtime screen.

This forces the user to jump mental modes between:
	•	operating an agent
	•	configuring deployment

Recommendation

Give it its own tab:

Workspace
Tools
Embed & Deployment
Logs
Settings

This:
	•	reduces cognitive switching
	•	clarifies intent
	•	supports scaling features

⸻

6️⃣ Improve Readability & Contrast

Current Issues
	•	Tool text contrast is low
	•	Thin font weights reduce legibility
	•	Panel edges visually blend
	•	Dense spacing strains readability

Recommended Adjustments

✔ Slightly brighten primary body text
✔ Increase line height to:

1.45 — 1.55

✔ Reduce dependency on borders
✔ Use spacing & elevation instead
✔ Reserve cyan glow for:
	•	primary actions
	•	active agents
	•	important system boundaries

Glow = design emphasis, not decoration.

⸻

7️⃣ Modernize Interaction & Motion

Recommended improvements:

✔ Button hover → glow ramp instead of instant
✔ Panels → soft easing on expand/collapse
✔ Status → subtle color transitions
✔ Notifications → quiet toast feedback

Avoid:

✘ pop-in modals
✘ large elastic motion
✘ abrupt color jumps

Motion should feel:
	•	intentional
	•	respectful
	•	professional

⸻

💡 Small High-Impact Enhancements
	•	Add breadcrumb indicator

Agent Workspace → Runtime

	•	Convert text links to pill buttons
	•	Turn “Disconnected” into a badge chip
	•	Add category icons:

MCP
Webhook
RAG
Vector
n8n

Icons improve recognition speed.

⸻

🧠 Product Direction Note

Your platform is evolving from:

“experimental agent builder”

toward:

“professional AI orchestration workspace”

These UI shifts help:
	•	lower cognitive friction
	•	improve confidence + trust
	•	support enterprise adoption
	•	make capabilities feel scalable

The foundation is already strong —
these refinements will make it feel:
	•	modern
	•	premium
	•	intentionally designed

⸻
