/** @param {import('react').ButtonHTMLAttributes<HTMLButtonElement> & {variant?:string}} props */
export function Button({variant='secondary',className='',type='button',...props}) {
  return <button type={type} className={`ui-button ui-button--${variant} ${className}`} {...props} />;
}
export function Field({label,children,className='',...props}) {
  return <label className={`ui-field ${className}`} {...props}><span>{label}</span>{children}</label>;
}
