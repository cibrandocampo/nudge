export default function cx(...args) {
  return args.filter(Boolean).join(' ')
}
