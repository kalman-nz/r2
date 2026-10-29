import { DATA_FIELDS, type ElementType } from "../../lib/labelSpec";

export interface FieldOption {
  key: string;
  label: string;
}

export const DEFAULT_FIELD_OPTIONS: FieldOption[] = DATA_FIELDS.map((f) => ({ key: f.key, label: f.label }));

export function typeName(type: ElementType, dataFields: boolean): string {
  switch (type) {
    case "text":
      return "Data text";
    case "staticText":
      return dataFields ? "Static text" : "Text";
    case "qr":
      return "QR code";
    case "barcode":
      return "Barcode";
    case "image":
      return "Image";
    case "rect":
      return "Box";
    case "ellipse":
      return "Ellipse";
    case "line":
      return "Line";
  }
}
