Names threads with an agent, so the sidebar reads like a list of what you were doing instead of a list of first lines.

## What you get

- Automatic naming once a thread's first turn finishes, from the opening of the conversation.
- A button in the thread header to re-generate the name on demand, and `kaioken thread-namer rename` to do the same from the CLI.
- A choice of which agent and model writes the names, with a custom instruction if you want a house style.

The naming run happens in a throwaway hidden thread, so the conversation being named is left untouched. Names the plugin wrote are remembered, so a title you typed yourself is never overwritten.
