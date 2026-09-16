export async function mount(ctx){
const {Services,localStorage,sessionStorage,document,window,navigator,location,history,fetch,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame,cancelAnimationFrame}=ctx;

document.querySelectorAll(".gallery-nav a").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();document.querySelector(a.getAttribute("href"))?.scrollIntoView({behavior:"smooth"});}));

}
