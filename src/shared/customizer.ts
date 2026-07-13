export type OpenScadPrimitive = string | number | boolean;
export type OpenScadValue = OpenScadPrimitive | OpenScadValue[];

export interface CustomizerRange {
  kind: "range";
  min: number;
  max: number;
  step?: number;
}

export interface CustomizerDropdown {
  kind: "dropdown";
  options: OpenScadPrimitive[];
}

export type CustomizerControl = CustomizerRange | CustomizerDropdown;

export interface CustomizerParameterBase {
  name: string;
  label: string;
  description?: string;
  group?: string;
  hidden: boolean;
  order: number;
  line: number;
  control?: CustomizerControl;
}

export interface CustomizerStringParameter extends CustomizerParameterBase {
  type: "string";
  value: string;
}

export interface CustomizerNumberParameter extends CustomizerParameterBase {
  type: "number";
  value: number;
}

export interface CustomizerBooleanParameter extends CustomizerParameterBase {
  type: "boolean";
  value: boolean;
}

export interface CustomizerVectorParameter extends CustomizerParameterBase {
  type: "vector";
  value: OpenScadValue[];
}

export type CustomizerParameter =
  | CustomizerStringParameter
  | CustomizerNumberParameter
  | CustomizerBooleanParameter
  | CustomizerVectorParameter;

export interface CustomizerGroup {
  name: string;
  order: number;
  hidden: boolean;
}

export interface CustomizerSchema {
  groups: CustomizerGroup[];
  parameters: CustomizerParameter[];
  stoppedAtHidden: boolean;
}

export interface ParseCustomizerOptions {
  /** Parse parameters after the special `[Hidden]` section marker. */
  includeHidden?: boolean;
}

interface CommentToken {
  kind: "line" | "block";
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  braceDepth: number;
  content: string;
}

interface AssignmentToken {
  name: string;
  valueSource: string;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Parse the literal, top-level variables exposed by OpenSCAD's Customizer. */
export function parseOpenScadCustomizer(
  source: string,
  options: ParseCustomizerOptions = {},
): CustomizerSchema {
  const { sanitized, comments } = stripComments(source);
  const assignments = findTopLevelAssignments(sanitized);
  const includeHidden = options.includeHidden ?? false;
  const groups: CustomizerGroup[] = [];
  const parameters: CustomizerParameter[] = [];
  let currentGroup: string | undefined;
  let hidden = false;
  const stoppedAtHidden = comments.some(
    (comment) => parseGroupMarker(comment)?.toLowerCase() === "hidden",
  );
  let commentIndex = 0;

  for (const assignment of assignments) {
    while (true) {
      const comment = comments[commentIndex];
      if (!comment || comment.start >= assignment.start) break;
      commentIndex++;
      const groupName = parseGroupMarker(comment);
      if (groupName === undefined) continue;

      if (groupName.toLowerCase() === "hidden") {
        hidden = true;
        currentGroup = undefined;
      } else if (!hidden || includeHidden) {
        currentGroup = groupName;
        if (!groups.some((group) => group.name === groupName && group.hidden === hidden)) {
          groups.push({ name: groupName, order: groups.length, hidden });
        }
      }
    }

    if (hidden && !includeHidden) break;

    const value = parseLiteral(assignment.valueSource);
    if (value === undefined) continue;

    const trailingComment = comments.find(
      (comment) =>
        comment.start >= assignment.end &&
        comment.startLine === assignment.endLine &&
        source.slice(assignment.end, comment.start).trim() === "",
    );
    const control = trailingComment
      ? parseControlAnnotation(trailingComment.content)
      : undefined;
    const precedingDescription = findPrecedingDescription(
      source,
      comments,
      assignment,
    );
    const trailingDescription =
      trailingComment && !control
        ? cleanDescription(trailingComment.content)
        : undefined;
    const description = precedingDescription || trailingDescription || undefined;
    const common = {
      name: assignment.name,
      label: humanizeIdentifier(assignment.name),
      ...(description ? { description } : {}),
      ...(currentGroup ? { group: currentGroup } : {}),
      hidden,
      order: parameters.length,
      line: assignment.startLine + 1,
      ...(control ? { control } : {}),
    };

    if (typeof value === "string") {
      parameters.push({ ...common, type: "string", value });
    } else if (typeof value === "number") {
      parameters.push({ ...common, type: "number", value });
    } else if (typeof value === "boolean") {
      parameters.push({ ...common, type: "boolean", value });
    } else {
      parameters.push({ ...common, type: "vector", value });
    }
  }

  return { groups, parameters, stoppedAtHidden };
}

/**
 * Convert values into individual OpenSCAD `-D` arguments.
 *
 * Each returned string is intended to be passed as one argv item after `-D`;
 * it is deliberately not shell-quoted.
 */
export function toOpenScadDefinitions(
  values: Readonly<Record<string, OpenScadValue>>,
): string[] {
  return Object.entries(values).map(([name, value]) => {
    if (!IDENTIFIER.test(name)) {
      throw new TypeError(`Invalid OpenSCAD variable name: ${name}`);
    }
    return `${name}=${serializeOpenScadValue(value)}`;
  });
}

export function serializeOpenScadValue(value: OpenScadValue): string {
  if (typeof value === "string") {
    return `"${value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")}"`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("OpenSCAD numeric definitions must be finite");
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeOpenScadValue(item)).join(", ")}]`;
  }
  throw new TypeError("Unsupported OpenSCAD definition value");
}

function stripComments(source: string): {
  sanitized: string;
  comments: CommentToken[];
} {
  // Keep UTF-16 indexing aligned with String#slice even when source contains
  // non-BMP characters (for example, emoji in a description).
  const output = source.split("");
  const comments: CommentToken[] = [];
  let index = 0;
  let line = 0;
  let inString = false;
  let braceDepth = 0;

  while (index < source.length) {
    const character = source.charAt(index);
    if (inString) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === '"') inString = false;
      if (character === "\n") line++;
      index++;
      continue;
    }
    if (character === '"') {
      inString = true;
      index++;
      continue;
    }
    if (character === "{") {
      braceDepth++;
      index++;
      continue;
    }
    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      index++;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      const start = index;
      const startLine = line;
      index += 2;
      const contentStart = index;
      while (index < source.length && source[index] !== "\n") index++;
      const end = index;
      comments.push({
        kind: "line",
        start,
        end,
        startLine,
        endLine: line,
        braceDepth,
        content: source.slice(contentStart, end),
      });
      for (let cursor = start; cursor < end; cursor++) output[cursor] = " ";
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const start = index;
      const startLine = line;
      index += 2;
      const contentStart = index;
      while (
        index < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        if (source[index] === "\n") line++;
        index++;
      }
      const contentEnd = index;
      index = Math.min(index + 2, source.length);
      const end = index;
      comments.push({
        kind: "block",
        start,
        end,
        startLine,
        endLine: line,
        braceDepth,
        content: source.slice(contentStart, contentEnd),
      });
      for (let cursor = start; cursor < end; cursor++) {
        if (output[cursor] !== "\n") output[cursor] = " ";
      }
      continue;
    }
    if (character === "\n") line++;
    index++;
  }

  return { sanitized: output.join(""), comments };
}

function findTopLevelAssignments(source: string): AssignmentToken[] {
  const assignments: AssignmentToken[] = [];
  let index = 0;
  let line = 0;
  let braceDepth = 0;
  let inString = false;

  while (index < source.length) {
    const character = source.charAt(index);
    if (inString) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === '"') inString = false;
      if (character === "\n") line++;
      index++;
      continue;
    }
    if (character === '"') {
      inString = true;
      index++;
      continue;
    }
    if (character === "\n") {
      line++;
      index++;
      continue;
    }
    if (character === "{") {
      braceDepth++;
      index++;
      continue;
    }
    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      index++;
      continue;
    }
    if (braceDepth !== 0 || !/[A-Za-z_]/.test(character)) {
      index++;
      continue;
    }

    const start = index;
    const startLine = line;
    index++;
    while (index < source.length && /[A-Za-z0-9_]/.test(source.charAt(index))) {
      index++;
    }
    const name = source.slice(start, index);
    while (index < source.length && /\s/.test(source.charAt(index))) {
      if (source[index] === "\n") line++;
      index++;
    }
    if (source[index] !== "=") continue;
    index++;
    const valueStart = index;
    let squareDepth = 0;
    let parenDepth = 0;
    let valueInString = false;
    while (index < source.length) {
      const valueCharacter = source.charAt(index);
      if (valueInString) {
        if (valueCharacter === "\\") {
          index += 2;
          continue;
        }
        if (valueCharacter === '"') valueInString = false;
      } else if (valueCharacter === '"') {
        valueInString = true;
      } else if (valueCharacter === "[") {
        squareDepth++;
      } else if (valueCharacter === "]") {
        squareDepth--;
      } else if (valueCharacter === "(") {
        parenDepth++;
      } else if (valueCharacter === ")") {
        parenDepth--;
      } else if (
        valueCharacter === ";" &&
        squareDepth === 0 &&
        parenDepth === 0
      ) {
        assignments.push({
          name,
          valueSource: source.slice(valueStart, index).trim(),
          start,
          end: index + 1,
          startLine,
          endLine: line,
        });
        index++;
        break;
      }
      if (valueCharacter === "\n") line++;
      index++;
    }
  }
  return assignments;
}

function parseLiteral(source: string): OpenScadValue | undefined {
  let index = 0;
  const whitespace = () => {
    while (index < source.length && /\s/.test(source.charAt(index))) index++;
  };
  const parseValue = (): OpenScadValue | undefined => {
    whitespace();
    if (source[index] === '"') {
      const start = index++;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === '"') {
          index++;
          try {
            return JSON.parse(source.slice(start, index)) as string;
          } catch {
            return undefined;
          }
        }
        index++;
      }
      return undefined;
    }
    if (source[index] === "[") {
      index++;
      const values: OpenScadValue[] = [];
      whitespace();
      if (source[index] === "]") {
        index++;
        return values;
      }
      while (index < source.length) {
        const value = parseValue();
        if (value === undefined) return undefined;
        values.push(value);
        whitespace();
        if (source[index] === "]") {
          index++;
          return values;
        }
        if (source[index] !== ",") return undefined;
        index++;
      }
      return undefined;
    }
    const start = index;
    while (index < source.length && !/[\s,\]]/.test(source.charAt(index))) {
      index++;
    }
    const token = source.slice(start, index);
    if (token === "true") return true;
    if (token === "false") return false;
    if (NUMBER.test(token)) {
      const number = Number(token);
      return Number.isFinite(number) ? number : undefined;
    }
    return undefined;
  };

  const value = parseValue();
  whitespace();
  return index === source.length ? value : undefined;
}

function parseGroupMarker(comment: CommentToken): string | undefined {
  if (comment.kind !== "block" || comment.braceDepth !== 0) return undefined;
  const match = comment.content.trim().match(/^\[\s*([^\]]+?)\s*\]$/);
  return match?.[1]?.trim() || undefined;
}

function parseControlAnnotation(content: string): CustomizerControl | undefined {
  const match = content.trim().match(/^\[(.*)\]$/s);
  if (!match) return undefined;
  const body = match[1]?.trim();
  if (body === undefined) return undefined;
  const rangeParts = body.split(":").map((part) => part.trim());
  if (
    (rangeParts.length === 2 || rangeParts.length === 3) &&
    rangeParts.every((part) => NUMBER.test(part))
  ) {
    const values = rangeParts.map(Number);
    if (!values.every(Number.isFinite)) return undefined;
    const min = values[0]!;
    if (rangeParts.length === 2) {
      return { kind: "range", min, max: values[1]! };
    }
    return { kind: "range", min, step: values[1]!, max: values[2]! };
  }

  const optionSources = splitCommaSeparated(body);
  if (optionSources.length === 0) return undefined;
  const options = optionSources.map((option) => parsePrimitive(option));
  if (options.some((option) => option === undefined)) return undefined;
  return { kind: "dropdown", options: options as OpenScadPrimitive[] };
}

function splitCommaSeparated(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let inString = false;
  for (let index = 0; index < source.length; index++) {
    const character = source.charAt(index);
    if (inString && character === "\\") {
      index++;
      continue;
    }
    if (character === '"') inString = !inString;
    if (!inString && character === ",") {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  const final = source.slice(start).trim();
  if (final) parts.push(final);
  return parts;
}

function parsePrimitive(source: string): OpenScadPrimitive | undefined {
  const value = parseLiteral(source);
  return Array.isArray(value) ? undefined : value;
}

function findPrecedingDescription(
  source: string,
  comments: CommentToken[],
  assignment: AssignmentToken,
): string | undefined {
  const candidates: CommentToken[] = [];
  let boundary = assignment.start;
  let expectedLine = assignment.startLine - 1;

  for (let index = comments.length - 1; index >= 0; index--) {
    const comment = comments[index];
    if (!comment) continue;
    if (comment.end > boundary) continue;
    if (parseGroupMarker(comment) !== undefined) break;
    if (comment.endLine !== expectedLine) break;
    if (source.slice(comment.end, boundary).trim() !== "") break;
    candidates.unshift(comment);
    boundary = comment.start;
    expectedLine = comment.startLine - 1;
  }

  const description = candidates
    .map((comment) => cleanDescription(comment.content))
    .filter(Boolean)
    .join(" ");
  return description || undefined;
}

function cleanDescription(description: string): string {
  return description
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, "").trim())
    .filter(Boolean)
    .join(" ");
}

function humanizeIdentifier(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : identifier;
}
