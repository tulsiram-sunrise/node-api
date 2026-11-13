const cursors = require("../lib/cursor");

describe("lib/cursor", () => {
    const payload = { d: 1234.5678901234, id: "665f1c2e9b1e8a0012345678", ctx: { r: 10 } };

    it("round-trips a payload, preserving exact numbers", () => {
        const sealed = cursors.seal(payload, "nearby");
        expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(cursors.open(sealed, "nearby")).toEqual(payload);
    });

    it("hides the payload from the client", () => {
        const raw = Buffer.from(cursors.seal(payload, "nearby"), "base64url").toString("latin1");
        expect(raw).not.toContain("1234.567");
        expect(raw).not.toContain(payload.id);
    });

    it("produces a different cursor each time (random IV)", () => {
        expect(cursors.seal(payload, "nearby")).not.toBe(cursors.seal(payload, "nearby"));
    });

    it("rejects a cursor sealed for another purpose", () => {
        expect(cursors.open(cursors.seal(payload, "other"), "nearby")).toBeNull();
    });

    it("rejects tampered, truncated and garbage input", () => {
        const sealed = cursors.seal(payload, "nearby");
        const bytes = Buffer.from(sealed, "base64url");
        bytes[bytes.length - 1] ^= 1;

        expect(cursors.open(bytes.toString("base64url"), "nearby")).toBeNull();
        expect(cursors.open(sealed.slice(0, 20), "nearby")).toBeNull();
        expect(cursors.open("not-a-cursor", "nearby")).toBeNull();
        expect(cursors.open("", "nearby")).toBeNull();
    });
});
