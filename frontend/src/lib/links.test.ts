import { describe, expect, it } from "vitest";
import { validateLink, type LinkFields } from "./links";
const valid: LinkFields = { title: "Useful", description: "", url: "https://example.com/path", icon: "link", color: "blue", visible: true };
describe("homepage link fields", () => {
  it.each(["javascript:alert(1)","data:text/html,x","//example.com","https://user:secret@example.com","https://example.com/a b","https:\\example.com",""])("rejects unsafe or incomplete destinations: %s",url => { expect(validateLink({...valid,url}).url).not.toBe(""); });
  it("allows a hidden unconfigured link and requires a title", () => {
    expect(validateLink({...valid,url:"",visible:false}).url).toBe("");
    expect(validateLink({...valid,title:"  "}).title).not.toBe("");
  });
  it("keeps descriptions optional and enforces field bounds", () => {
    expect(validateLink(valid)).toEqual({ title:"",description:"",url:"" });
    expect(validateLink({...valid,title:"x".repeat(101)}).title).not.toBe("");
    expect(validateLink({...valid,description:"x".repeat(301)}).description).not.toBe("");
  });
});
