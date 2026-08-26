const ELEMENT_TYPES = ["text", "barcode", "qr", "staticText", "image"];
const ALIGN = ["left", "center", "right"];
const VALIGN = ["top", "middle", "bottom"];
const ROTATIONS = [0, 90, 180, 270];

function validateTemplateBody(data) {
  if (!data || typeof data !== "object") throw new BadRequestError("Invalid body");
  if (typeof data.name !== "string" || !data.name) throw new BadRequestError("name is required");
  if (typeof data.widthMm !== "number" || data.widthMm <= 0) throw new BadRequestError("widthMm must be a positive number");
  if (typeof data.heightMm !== "number" || data.heightMm <= 0) throw new BadRequestError("heightMm must be a positive number");
  if (!Array.isArray(data.elements)) throw new BadRequestError("elements must be an array");

  for (const el of data.elements) {
    if (!el || typeof el.id !== "string") throw new BadRequestError("each element needs an id");
    if (ELEMENT_TYPES.indexOf(el.type) === -1) throw new BadRequestError("invalid element type: " + el.type);
    for (const key of ["x", "y", "width", "height"]) {
      if (typeof el[key] !== "number") throw new BadRequestError("element " + el.id + "." + key + " must be a number");
    }
    if (el.align !== undefined && ALIGN.indexOf(el.align) === -1) throw new BadRequestError("invalid align");
    if (el.valign !== undefined && VALIGN.indexOf(el.valign) === -1) throw new BadRequestError("invalid valign");
    if (el.rotation !== undefined && ROTATIONS.indexOf(el.rotation) === -1) throw new BadRequestError("invalid rotation");
  }

  return {
    name: data.name,
    widthMm: data.widthMm,
    heightMm: data.heightMm,
    elements: data.elements,
  };
}

function toLabelJson(record) {
  return {
    id: record.id,
    name: record.get("name"),
    widthMm: record.get("widthMm"),
    heightMm: record.get("heightMm"),
    elements: record.get("elements"),
  };
}

module.exports = { validateTemplateBody, toLabelJson };
