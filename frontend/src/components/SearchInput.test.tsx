import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SearchInput from "./SearchInput";

describe("SearchInput", () => {
  it("submits the current value on Enter without searching on each keystroke", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchInput placeholder="Search posts..." onSearch={onSearch} />);

    const input = screen.getByPlaceholderText("Search posts...");
    await user.type(input, "release notes");
    expect(onSearch).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onSearch).toHaveBeenCalledWith("release notes");
  });

  it("clears active search results as soon as the input becomes empty", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchInput value="existing query" onSearch={onSearch} />);

    await user.clear(screen.getByRole("textbox"));

    expect(onSearch).toHaveBeenCalledOnce();
    expect(onSearch).toHaveBeenCalledWith("");
  });

  it("applies an external value without losing focus or moving the cursor to the start", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const { rerender } = render(<SearchInput value="first" onSearch={onSearch} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;

    await user.click(input);
    rerender(<SearchInput value="restored search" onSearch={onSearch} />);

    expect(input).toHaveValue("restored search");
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe("restored search".length);
    expect(input.selectionEnd).toBe("restored search".length);
  });
});
