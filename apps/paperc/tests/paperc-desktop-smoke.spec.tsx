import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PaperCApp } from "../../paperc-desktop/src/PaperCApp";

describe("PaperC desktop smoke", () => {
  it("renders app shell with no-camera fallback", () => {
    const html = renderToStaticMarkup(<PaperCApp />);
    expect(html).toContain("PaperC Desktop");
    expect(html).toContain("No camera detected. Running in mock/manual mode.");
  });
});
