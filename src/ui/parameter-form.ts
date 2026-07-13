import type { CustomizerSchema } from "../shared/customizer.js";
import { cloneValues, type DesignValues, type ParameterSchema, type ParameterValue } from "./types.js";

type ChangeHandler = (values: DesignValues) => void;

export class ParameterForm {
  private values: DesignValues = {};
  private schema?: ParameterSchema;

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: ChangeHandler,
  ) {}

  render(schema: ParameterSchema | CustomizerSchema | undefined, values: DesignValues): void {
    this.schema = normalizeSchema(schema);
    this.values = cloneValues(values);
    this.root.replaceChildren();

    if (!this.schema?.properties || Object.keys(this.schema.properties).length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-copy";
      empty.textContent = "This model does not expose any customizable parameters.";
      this.root.append(empty);
      return;
    }

    const grouped = new Map<string, Array<[string, ParameterSchema]>>();
    const properties = Object.entries(this.schema.properties).sort(
      ([, a], [, b]) => (a["x-order"] ?? 0) - (b["x-order"] ?? 0),
    );
    for (const property of properties) {
      const group = property[1]["x-group"] ?? property[1].group ?? "Parameters";
      const entries = grouped.get(group) ?? [];
      entries.push(property);
      grouped.set(group, entries);
    }

    for (const [group, entries] of grouped) {
      const section = document.createElement("section");
      section.className = "parameter-group";
      const heading = document.createElement("h3");
      heading.textContent = group;
      section.append(heading);
      for (const [key, propertySchema] of entries) {
        const current = this.values[key] ?? propertySchema.default ?? defaultFor(propertySchema);
        if (!(key in this.values)) this.values[key] = current;
        section.append(this.createField(propertySchema, [key], current, key));
      }
      this.root.append(section);
    }
  }

  getValues(): DesignValues {
    return cloneValues(this.values);
  }

  private createField(
    schema: ParameterSchema,
    path: string[],
    value: ParameterValue,
    fallbackLabel: string,
  ): HTMLElement {
    if (schema["x-widget"] === "hidden") {
      const hidden = document.createElement("span");
      hidden.hidden = true;
      return hidden;
    }

    if (schema.type === "object" && schema.properties) {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "nested-parameters";
      const legend = document.createElement("legend");
      legend.textContent = schema.title ?? humanize(fallbackLabel);
      fieldset.append(legend);
      const objectValue = isRecord(value) ? value : {};
      for (const [key, child] of Object.entries(schema.properties)) {
        fieldset.append(
          this.createField(child, [...path, key], objectValue[key] ?? child.default ?? defaultFor(child), key),
        );
      }
      return fieldset;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "parameter-field";
    const id = `parameter-${path.join("-")}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = schema.title ?? humanize(fallbackLabel);
    wrapper.append(label);

    if (schema.description) {
      const description = document.createElement("p");
      description.className = "field-description";
      description.textContent = schema.description;
      wrapper.append(description);
    }

    const control = this.createControl(schema, path, value, id);
    wrapper.append(control);
    return wrapper;
  }

  private createControl(
    schema: ParameterSchema,
    path: string[],
    value: ParameterValue,
    id: string,
  ): HTMLElement {
    if (schema.enum?.length) {
      const select = document.createElement("select");
      select.id = id;
      select.disabled = schema.readOnly === true;
      schema.enum.forEach((option, index) => {
        const element = document.createElement("option");
        element.value = String(option);
        element.textContent = schema.enumNames?.[index] ?? String(option);
        element.selected = option === value;
        select.append(element);
      });
      select.addEventListener("change", () => {
        const selected = schema.enum?.find((option) => String(option) === select.value);
        this.commit(path, (selected ?? select.value) as ParameterValue);
      });
      return select;
    }

    if (schema.type === "boolean") {
      const row = document.createElement("div");
      row.className = "switch-row";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.role = "switch";
      input.id = id;
      input.checked = Boolean(value);
      input.disabled = schema.readOnly === true;
      input.addEventListener("change", () => this.commit(path, input.checked));
      row.append(input);
      return row;
    }

    if (schema.type === "number" || schema.type === "integer") {
      const isSlider =
        schema["x-widget"] === "slider" ||
        (schema.minimum !== undefined && schema.maximum !== undefined);
      if (isSlider) return this.createSlider(schema, path, Number(value), id);
      const input = document.createElement("input");
      input.type = "number";
      input.id = id;
      input.value = String(value ?? 0);
      input.min = schema.minimum?.toString() ?? "";
      input.max = schema.maximum?.toString() ?? "";
      input.step = schema.type === "integer" ? "1" : String(schema.multipleOf ?? "any");
      input.disabled = schema.readOnly === true;
      input.addEventListener("input", () => {
        if (input.validity.valid && input.value !== "") {
          this.commit(path, schema.type === "integer" ? Number.parseInt(input.value, 10) : Number(input.value));
        }
      });
      return input;
    }

    if (schema.type === "array") {
      const values = Array.isArray(value) ? value : [];
      const numericVector =
        schema.items?.type === "number" || schema.items?.type === "integer";
      if (numericVector && values.length <= 4) {
        const row = document.createElement("div");
        row.className = "vector-input";
        values.forEach((item, index) => {
          const input = document.createElement("input");
          input.type = "number";
          input.value = String(item);
          input.setAttribute("aria-label", `${path.at(-1)} component ${index + 1}`);
          input.min = schema.items?.minimum?.toString() ?? "";
          input.max = schema.items?.maximum?.toString() ?? "";
          input.step = schema.items?.type === "integer" ? "1" : String(schema.items?.multipleOf ?? "any");
          input.disabled = schema.readOnly === true;
          input.addEventListener("input", () => {
            if (!input.validity.valid || input.value === "") return;
            const latest = getAtPath(this.values, path);
            const next = Array.isArray(latest) ? [...latest] : [...values];
            next[index] = Number(input.value);
            this.commit(path, next);
          });
          row.append(input);
        });
        return row;
      }
    }

    if (schema["x-widget"] === "textarea" || schema.type === "array" || schema.type === "object") {
      const textarea = document.createElement("textarea");
      textarea.id = id;
      textarea.rows = 3;
      textarea.value = typeof value === "string" ? value : JSON.stringify(value);
      textarea.disabled = schema.readOnly === true;
      textarea.addEventListener("change", () => {
        if (schema.type === "array" || schema.type === "object") {
          try {
            this.commit(path, JSON.parse(textarea.value) as ParameterValue);
            textarea.setCustomValidity("");
          } catch {
            textarea.setCustomValidity("Enter valid JSON");
            textarea.reportValidity();
          }
        } else {
          this.commit(path, textarea.value);
        }
      });
      return textarea;
    }

    const input = document.createElement("input");
    input.type = schema["x-widget"] === "color" ? "color" : "text";
    input.id = id;
    input.value = String(value ?? "");
    input.disabled = schema.readOnly === true;
    input.addEventListener("input", () => this.commit(path, input.value));
    return input;
  }

  private createSlider(
    schema: ParameterSchema,
    path: string[],
    value: number,
    id: string,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "slider-row";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.id = id;
    slider.min = String(schema.minimum ?? 0);
    slider.max = String(schema.maximum ?? 100);
    slider.step = schema.type === "integer" ? "1" : String(schema.multipleOf ?? 0.1);
    slider.value = String(value);
    slider.disabled = schema.readOnly === true;
    const number = document.createElement("input");
    number.type = "number";
    number.value = String(value);
    number.min = slider.min;
    number.max = slider.max;
    number.step = slider.step;
    number.disabled = schema.readOnly === true;
    const update = (raw: string): void => {
      const next = schema.type === "integer" ? Number.parseInt(raw, 10) : Number(raw);
      if (!Number.isFinite(next)) return;
      slider.value = String(next);
      number.value = String(next);
      this.commit(path, next);
    };
    slider.addEventListener("input", () => update(slider.value));
    number.addEventListener("input", () => number.validity.valid && update(number.value));
    row.append(slider, number);
    return row;
  }

  private commit(path: string[], value: ParameterValue): void {
    setAtPath(this.values, path, value);
    this.onChange(this.getValues());
  }
}

function setAtPath(target: DesignValues, path: string[], value: ParameterValue): void {
  let cursor: Record<string, ParameterValue> = target;
  for (const key of path.slice(0, -1)) {
    const child = cursor[key];
    if (!isRecord(child)) cursor[key] = {};
    cursor = cursor[key] as Record<string, ParameterValue>;
  }
  cursor[path.at(-1)!] = value;
}

function getAtPath(target: DesignValues, path: string[]): ParameterValue | undefined {
  let cursor: ParameterValue | undefined = target;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function isRecord(value: ParameterValue | undefined): value is Record<string, ParameterValue> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function defaultFor(schema: ParameterSchema): ParameterValue {
  if (schema.enum?.length) return schema.enum[0] ?? "";
  switch (schema.type) {
    case "boolean": return false;
    case "number":
    case "integer": return schema.minimum ?? 0;
    case "array": return [];
    case "object": return {};
    default: return "";
  }
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function normalizeSchema(
  schema: ParameterSchema | CustomizerSchema | undefined,
): ParameterSchema | undefined {
  if (!schema || !("parameters" in schema)) return schema;

  const groupOrder = new Map(schema.groups.map((group) => [group.name, group.order]));
  const properties: Record<string, ParameterSchema> = {};
  const parameters = [...schema.parameters].sort((a, b) => {
    const groupDifference = (groupOrder.get(a.group ?? "") ?? 0) - (groupOrder.get(b.group ?? "") ?? 0);
    return groupDifference || a.order - b.order;
  });

  for (const parameter of parameters) {
    if (parameter.hidden) continue;
    const property: ParameterSchema = {
      title: parameter.label,
      description: parameter.description,
      default: parameter.value as ParameterValue,
      "x-group": parameter.group ?? "Parameters",
      "x-order": parameter.order,
    };
    switch (parameter.type) {
      case "boolean":
        property.type = "boolean";
        break;
      case "number":
        property.type = "number";
        break;
      case "vector":
        property.type = "array";
        property.items = { type: "number" };
        property.minItems = parameter.value.length;
        property.maxItems = parameter.value.length;
        break;
      default:
        property.type = "string";
    }
    if (parameter.control?.kind === "range") {
      property["x-widget"] = "slider";
      property.minimum = parameter.control.min;
      property.maximum = parameter.control.max;
      property.multipleOf = parameter.control.step;
      if (parameter.type === "vector" && property.items) {
        property.items.minimum = parameter.control.min;
        property.items.maximum = parameter.control.max;
        property.items.multipleOf = parameter.control.step;
      }
    } else if (parameter.control?.kind === "dropdown") {
      property.enum = parameter.control.options as Array<string | number | boolean>;
    }
    properties[parameter.name] = property;
  }
  return { type: "object", properties };
}
