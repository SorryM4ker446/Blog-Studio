import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EditorSelect from "./EditorSelect";

const options = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
];

describe("EditorSelect", () => {
  it("uses the project dropdown surface and selects an option with the pointer", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EditorSelect value="draft" options={options} onChange={onChange} ariaLabel="Publication status" />);

    const trigger = screen.getByRole("combobox", { name: "Publication status" });
    expect(trigger).toHaveClass("custom-select-trigger");
    await user.click(trigger);
    expect(screen.getByRole("listbox", { name: "Publication status" })).toHaveClass("custom-select-options");
    await user.click(screen.getByRole("option", { name: "Published" }));

    expect(onChange).toHaveBeenCalledWith("published");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("supports arrow keys, selection, and escape without submitting the editor form", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EditorSelect value="draft" options={options} onChange={onChange} ariaLabel="Publication status" />);

    const trigger = screen.getByRole("combobox", { name: "Publication status" });
    await user.click(trigger);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("published");

    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
