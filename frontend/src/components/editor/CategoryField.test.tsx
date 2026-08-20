import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import CategoryField from "./CategoryField";

const categories = [
  { id: 1, name: "Engineering", description: "", created_at: "2026-01-01T00:00:00Z" },
  { id: 2, name: "Notes", description: "", created_at: "2026-01-01T00:00:00Z" },
];

describe("CategoryField", () => {
  it("uses the themed labelled selection control and reports changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CategoryField
        categories={categories}
        value={1}
        onChange={onChange}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Post category" }));
    await user.click(screen.getByRole("option", { name: "Notes" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("creates a category from the keyboard and keeps API errors visible", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValueOnce("That category already exists.").mockResolvedValueOnce(null);
    render(
      <CategoryField
        categories={categories}
        value={0}
        onChange={vi.fn()}
        onCreate={onCreate}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create category" }));
    const input = screen.getByRole("textbox", { name: "Category name" });
    await user.type(input, "Engineering{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");

    await user.clear(input);
    await user.type(input, "Research{Enter}");
    expect(onCreate).toHaveBeenLastCalledWith("Research");
    expect(screen.queryByRole("textbox", { name: "Category name" })).not.toBeInTheDocument();
  });

  it("ignores repeated submissions while a category request is pending", async () => {
    const user = userEvent.setup();
    let resolveCreate: (message: string | null) => void = () => undefined;
    const onCreate = vi.fn(() => new Promise<string | null>((resolve) => {
      resolveCreate = resolve;
    }));
    render(
      <CategoryField
        categories={categories}
        value={0}
        onChange={vi.fn()}
        onCreate={onCreate}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create category" }));
    const input = screen.getByRole("textbox", { name: "Category name" });
    await user.type(input, "Research{Enter}{Enter}{Escape}");

    expect(onCreate).toHaveBeenCalledOnce();
    expect(input).toBeInTheDocument();
    resolveCreate(null);
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Category name" })).not.toBeInTheDocument());
  });

  it("exposes rename and delete actions for the selected category", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(null);
    const onDelete = vi.fn();
    render(
      <CategoryField
        categories={categories}
        value={1}
        onChange={vi.fn()}
        onCreate={vi.fn()}
        onRename={onRename}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Post category" }));
    await user.click(screen.getByRole("button", { name: "Rename Engineering" }));
    const input = screen.getByRole("textbox", { name: "New category name" });
    await user.clear(input);
    await user.type(input, "Platform{Enter}");
    expect(onRename).toHaveBeenCalledWith(1, "Platform");

    await user.click(screen.getByRole("button", { name: "Delete Engineering" }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("keeps the original rename target when the selected value changes externally", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(null);
    const props = {
      categories,
      onChange: vi.fn(),
      onCreate: vi.fn(),
      onRename,
      onDelete: vi.fn(),
    };
    const { rerender } = render(<CategoryField {...props} value={1} />);

    await user.click(screen.getByRole("combobox", { name: "Post category" }));
    await user.click(screen.getByRole("button", { name: "Rename Engineering" }));
    rerender(<CategoryField {...props} value={2} />);
    const input = screen.getByRole("textbox", { name: "New category name" });
    await user.clear(input);
    await user.type(input, "Platform{Enter}");

    expect(onRename).toHaveBeenCalledWith(1, "Platform");
  });
});
