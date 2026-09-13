import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EditorSelect from "./EditorSelect";

const options = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
];

describe("EditorSelect", () => {
  it("restores rename focus after a disabled refresh without closing the management menu", async () => {
    const user = userEvent.setup();
    let finish!: (result: null) => void;
    const rename = vi.fn(() => new Promise<null>(resolve => { finish = resolve; }));
    const props = { value: "draft", options, onChange: vi.fn(), ariaLabel: "Category", onRenameOption: rename, onDeleteOption: vi.fn() };
    const view = render(<EditorSelect {...props} />);
    const trigger = screen.getByRole("combobox");
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Rename Draft" }));
    await user.type(screen.getByLabelText("New category name"), " renamed{Enter}");
    view.rerender(<EditorSelect {...props} disabled />);
    await act(async () => finish(null));
    view.rerender(<EditorSelect {...props} options={[{ value: "draft", label: "Draft renamed" }, options[1]]} />);
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.tab();
    expect(screen.getByRole("button", { name: "Rename Draft renamed" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Delete Draft renamed" })).toHaveFocus();
  });
  it("identifies an unavailable selection without selecting the first option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EditorSelect value="removed" options={options} onChange={onChange} ariaLabel="Category" unavailableLabel="Unavailable category" />);
    const trigger = screen.getByRole("combobox", { name: "Category" });
    expect(trigger).toHaveTextContent("Unavailable category");
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    await user.click(trigger);
    expect(screen.queryByRole("option", { selected: true })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledWith("draft");
  });
  it("uses the project dropdown surface and selects an option with the pointer", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EditorSelect value="draft" options={options} onChange={onChange} ariaLabel="Publication status" />);

    const trigger = screen.getByRole("combobox", { name: "Publication status" });
    expect(trigger).toHaveClass("custom-select-trigger");
    await user.click(trigger);
    expect(screen.getByRole("listbox", { name: "Publication status" })).toHaveClass("custom-select-list");
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
