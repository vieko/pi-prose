/**
 * pi-prose - output styles for Pi with an always-on prose contract.
 *
 * Two layers:
 *
 * 1. Named output styles (Claude Code parity, plus extras):
 *      default        - no-op; the model's normal behavior
 *      matter-of-fact - BLUF, concise, value-first; mined from real usage
 *      proactive      - act immediately, minimize interruptions
 *      explanatory    - explain implementation choices while working
 *      learning       - collaborative learn-by-doing with TODO(human)
 *      ste            - ASD-STE100 Simplified Technical English
 *
 *    Custom styles are Markdown files with optional frontmatter
 *    (`name`, `description`) in:
 *      - `~/.pi/agent/prose/*.md`  (user)
 *      - `.pi/prose/*.md`          (project, trusted only; wins by name)
 *
 * 2. Always-on prose contract: if `contract.md` exists in either directory
 *    (project wins), its body is appended to the system prompt on every
 *    turn regardless of the selected style. Use it to normalize prose
 *    across models without giving up style switching.
 *
 * Usage:
 *   /style                     - picker (also shows the active style)
 *   /style <name>              - activate for this session
 *   /style <name> --save       - also save as your user default
 *   /style <name> --project    - also save as the project default
 *   /style off                 - back to default for this session
 *   /style off --save          - clear the saved user default
 *   pi --style <name>          - start with a style
 *
 * Precedence for the active style: session choice > project default >
 * user default > `default`. Style changes apply on the next prompt -- no
 * new session needed -- because the system prompt is rebuilt every turn.
 * The session choice persists in the session file and survives resume
 * and fork.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

interface Style {
	name: string;
	description: string;
	instructions: string;
	source: "builtin" | "user" | "project";
}

const DIR_NAME = "prose";
const CONTRACT_FILENAME = "contract.md";
const CONFIG_FILENAME = "config.json";
const ENTRY_TYPE = "pi-prose-style";

const BUILTIN_STYLES: Style[] = [
	{
		name: "default",
		description: "The model's normal behavior",
		instructions: "",
		source: "builtin",
	},
	{
		name: "matter-of-fact",
		description: "BLUF, concise, value-first, plain register",
		instructions: `Follow these rules for all prose addressed to the user:

- Lead with the answer or result (BLUF). No preamble, no restating the question, no compliments about the question.
- Match response length to the request. A short question gets a short answer.
- Write in sentences. Use bullets only for truly enumerable items (files, options, steps), never as a substitute for prose. Do not add headings to short replies.
- Do not use em dashes. Use "--", or restructure with a colon, semicolon, or comma.
- Value first: when presenting a change, PR, or proposal, state what it brings to the table before explaining mechanism.
- State each tradeoff or caveat once. Do not hedge repeatedly or balance every statement with a counterpoint.
- No sycophancy, no filler ("Certainly!", "Great question"), no closing recap of what you just said.
- Keep reasoning in answers minimal by default; expand only when the user asks to understand or teach.
- Plain, matter-of-fact register. Precision over polish; do not write like a press release or a thought-leadership post.`,
		source: "builtin",
	},
	{
		name: "proactive",
		description: "Execute immediately, minimize interruptions, prefer action over planning",
		instructions: `Execute immediately. Make reasonable assumptions instead of pausing for routine decisions, and prefer action over planning. Do not ask for confirmation on routine, reversible steps; report what you did instead. This never overrides explicit safety rules from project instructions: destructive or irreversible operations still require user approval.`,
		source: "builtin",
	},
	{
		name: "explanatory",
		description: "Explain implementation choices and codebase patterns while working",
		instructions: `Provide educational insights while completing tasks. After significant changes or decisions, add a short "Insight:" note (2-4 sentences) explaining the implementation choice, the relevant codebase pattern, or the tradeoff taken.`,
		source: "builtin",
	},
	{
		name: "learning",
		description: "Collaborative learn-by-doing: user writes small pieces of code",
		instructions: `Collaborative, learn-by-doing mode. Share brief insights while coding, and ask the user to contribute small, strategic pieces of code themselves. When you want the user to implement something, insert a TODO(human) marker in the code with a one-line description of what to implement, then stop and wait for their contribution before continuing.`,
		source: "builtin",
	},
	{
		name: "ste",
		description: "ASD-STE100 Simplified Technical English",
		instructions: `Write all prose to the user in ASD-STE100 Simplified Technical English:

- Use the active voice. Make the doer of the action the subject of the sentence.
- Keep sentences short: maximum 20 words in instructions, 25 words in descriptions.
- Give one instruction per sentence. Write one topic per paragraph, maximum 6 sentences.
- Use the simple present tense unless a different tense is necessary.
- Use one word for one meaning, and the same word for the same thing every time. Do not vary vocabulary for elegance.
- Do not make noun clusters of more than three nouns.
- Use articles (a, an, the) where English permits. Do not telegraph.
- In warnings and cautions, give the condition first, then the instruction.`,
		source: "builtin",
	},
];

/** Minimal frontmatter parse: returns { fields, body }. */
function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
	const fields: Record<string, string> = {};
	if (!raw.startsWith("---")) return { fields, body: raw.trim() };
	const end = raw.indexOf("\n---", 3);
	if (end === -1) return { fields, body: raw.trim() };
	const header = raw.slice(3, end);
	for (const line of header.split("\n")) {
		const idx = line.indexOf(":");
		if (idx === -1) continue;
		const key = line.slice(0, idx).trim();
		const value = line
			.slice(idx + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		if (key) fields[key] = value;
	}
	const body = raw.slice(end + 4).replace(/^-*\s*/, "").trim();
	return { fields, body };
}

function userDir(): string {
	return join(getAgentDir(), DIR_NAME);
}

function projectDir(cwd: string): string {
	return join(cwd, CONFIG_DIR_NAME, DIR_NAME);
}

function loadStylesFromDir(dir: string, source: "user" | "project"): Style[] {
	if (!existsSync(dir)) return [];
	const styles: Style[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	for (const file of entries) {
		if (!file.endsWith(".md") || file.toLowerCase() === CONTRACT_FILENAME) continue;
		try {
			const raw = readFileSync(join(dir, file), "utf-8");
			const { fields, body } = parseFrontmatter(raw);
			if (!body) continue;
			styles.push({
				name: (fields.name ?? basename(file, ".md")).toLowerCase().replace(/\s+/g, "-"),
				description: fields.description ?? body.split("\n")[0].slice(0, 80),
				instructions: body,
				source,
			});
		} catch {
			// Unreadable style file: skip.
		}
	}
	return styles;
}

function loadContract(dir: string): string | undefined {
	const path = join(dir, CONTRACT_FILENAME);
	if (!existsSync(path)) return undefined;
	try {
		const { body } = parseFrontmatter(readFileSync(path, "utf-8"));
		return body || undefined;
	} catch {
		return undefined;
	}
}

function readConfig(dir: string): { default?: string } {
	const path = join(dir, CONFIG_FILENAME);
	if (!existsSync(path)) return {};
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8"));
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

function writeConfig(dir: string, config: { default?: string }) {
	mkdirSync(dirname(join(dir, CONFIG_FILENAME)), { recursive: true });
	writeFileSync(join(dir, CONFIG_FILENAME), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export default function piProse(pi: ExtensionAPI) {
	let styles: Style[] = [...BUILTIN_STYLES];
	let contract: string | undefined;
	let activeStyle: Style = BUILTIN_STYLES[0];
	/** True once the user picked a style in this session (beats saved defaults). */
	let sessionChoice = false;

	pi.registerFlag("style", {
		description: "Output style to activate at startup",
		type: "string",
	});

	function findStyle(name: string): Style | undefined {
		const wanted = name.toLowerCase();
		if (wanted === "off" || wanted === "none") return styles.find((s) => s.name === "default");
		return styles.find((s) => s.name === wanted);
	}

	/** Later sources win by name: builtin < user < project. */
	function loadAll(ctx: ExtensionContext) {
		const trusted = ctx.isProjectTrusted();
		contract = (trusted ? loadContract(projectDir(ctx.cwd)) : undefined) ?? loadContract(userDir());
		const merged = new Map<string, Style>();
		for (const s of BUILTIN_STYLES) merged.set(s.name, s);
		for (const s of loadStylesFromDir(userDir(), "user")) merged.set(s.name, s);
		if (trusted) {
			for (const s of loadStylesFromDir(projectDir(ctx.cwd), "project")) merged.set(s.name, s);
		}
		styles = [...merged.values()];
	}

	function resolveDefault(ctx: ExtensionContext): Style {
		const projectDefault = ctx.isProjectTrusted() ? readConfig(projectDir(ctx.cwd)).default : undefined;
		const userDefault = readConfig(userDir()).default;
		for (const name of [projectDefault, userDefault]) {
			if (!name) continue;
			const style = findStyle(name);
			if (style) return style;
		}
		return styles.find((s) => s.name === "default") ?? BUILTIN_STYLES[0];
	}

	function updateStatus(ctx: ExtensionContext) {
		if (activeStyle.name === "default") {
			ctx.ui.setStatus("pi-prose", undefined);
		} else {
			ctx.ui.setStatus("pi-prose", ctx.ui.theme.fg("accent", `style:${activeStyle.name}`));
		}
	}

	function activate(style: Style, ctx: ExtensionContext, persist: boolean) {
		activeStyle = style;
		if (persist) {
			sessionChoice = true;
			pi.appendEntry(ENTRY_TYPE, { style: style.name });
		}
		updateStatus(ctx);
	}

	pi.registerCommand("style", {
		description: "Switch output style (see pi-prose)",
		getArgumentCompletions: (prefix: string) => {
			const items = styles
				.filter((s) => s.name.startsWith(prefix.toLowerCase()))
				.map((s) => ({ value: s.name, label: `${s.name} -- ${s.description}` }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			loadAll(ctx); // pick up style file edits without /reload

			const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
			const save = tokens.includes("--save");
			const project = tokens.includes("--project");
			const requested = tokens.find((t) => !t.startsWith("--"));

			if (requested) {
				const style = findStyle(requested);
				if (!style) {
					ctx.ui.notify(`Unknown style "${requested}". Available: ${styles.map((s) => s.name).join(", ")}`, "error");
					return;
				}
				activate(style, ctx, true);
				const cleared = style.name === "default";
				if (save) writeConfig(userDir(), cleared ? {} : { default: style.name });
				if (project) {
					if (ctx.isProjectTrusted()) {
						writeConfig(projectDir(ctx.cwd), cleared ? {} : { default: style.name });
					} else {
						ctx.ui.notify("Project is not trusted; did not write project default", "warning");
					}
				}
				const saved = save ? " (saved as user default)" : project ? " (saved as project default)" : "";
				ctx.ui.notify(`Output style: ${style.name}${saved}`, "info");
				return;
			}

			if (!ctx.hasUI) return;
			const labels = styles.map(
				(s) => `${s.name === activeStyle.name ? "* " : "  "}${s.name.padEnd(16)} ${s.description}`,
			);
			const choice = await ctx.ui.select("Output style", labels);
			if (!choice) return;
			const style = findStyle(choice.slice(2).trim().split(/\s+/)[0]);
			if (style) {
				activate(style, ctx, true);
				ctx.ui.notify(`Output style: ${style.name}`, "info");
			}
		},
	});

	// Append contract + active style every turn, whatever the model.
	pi.on("before_agent_start", async (event) => {
		const parts = [event.systemPrompt];
		if (contract) parts.push(`## Prose Contract (always on)\n\n${contract}`);
		if (activeStyle.instructions) {
			parts.push(`## Output Style: ${activeStyle.name}\n\n${activeStyle.instructions}`);
		}
		if (parts.length === 1) return undefined;
		return { systemPrompt: parts.join("\n\n") };
	});

	pi.on("session_start", async (_event, ctx) => {
		loadAll(ctx);
		sessionChoice = false;

		// CLI flag > persisted session choice > project default > user default.
		const flag = pi.getFlag("style");
		if (typeof flag === "string" && flag) {
			const style = findStyle(flag);
			if (style) {
				activate(style, ctx, true);
				return;
			}
			ctx.ui.notify(`Unknown style "${flag}". Available: ${styles.map((s) => s.name).join(", ")}`, "warning");
		}

		let restored: string | undefined;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
				restored = (entry.data as { style?: string } | undefined)?.style;
			}
		}
		if (restored) {
			const style = findStyle(restored);
			if (style) {
				sessionChoice = true;
				activeStyle = style;
				updateStatus(ctx);
				return;
			}
		}

		activeStyle = resolveDefault(ctx);
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("pi-prose", undefined);
	});
}
