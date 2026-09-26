import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function ReleaseNotes({ notes }: { notes: string }) {
  return <div className="min-w-0 max-w-prose text-sm leading-relaxed text-muted-foreground wrap-anywhere
    [&>*+*]:mt-3 [&_:is(h1,h2,h3,h4,h5,h6)]:text-base [&_:is(h1,h2,h3,h4,h5,h6)]:font-medium [&_:is(h1,h2,h3,h4,h5,h6)]:text-foreground
    [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_li+li]:mt-1 [&_li>ul]:mt-1 [&_li>ol]:mt-1 [&_input]:mr-2
    [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-foreground [&_strong]:font-medium [&_strong]:text-foreground
    [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:py-2 [&_code]:text-xs [&_blockquote]:border-l [&_blockquote]:pl-4 [&_hr]:border-border
    [&_table]:w-full [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground [&_th]:border-b [&_td]:border-b [&_th]:p-2 [&_td]:p-2 [&_img]:max-w-full [&_img]:h-auto">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      img: ({ node, src, ...props }) => src ? <img {...props} src={src} /> : null,
      table: ({ node, ...props }) => <div className="overflow-x-auto"><table {...props} /></div>,
    }}>{notes}</Markdown>
  </div>;
}
