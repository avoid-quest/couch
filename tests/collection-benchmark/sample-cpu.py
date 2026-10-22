import pathlib,sys,time,json,os
pid=int(sys.argv[1]);seconds=float(sys.argv[2]);hz=os.sysconf('SC_CLK_TCK')
def read():
 s=pathlib.Path('/proc',str(pid),'stat').read_text().split(') ',1)[1].split()
 return int(s[11])+int(s[12]),int(s[21])*os.sysconf('SC_PAGE_SIZE')
a,r=read();start=time.monotonic();time.sleep(seconds);b,rss=read();elapsed=time.monotonic()-start
print(json.dumps(dict(pid=pid,elapsed=round(elapsed,4),cpuPercent=round((b-a)/hz/elapsed*100,2),rssMB=round(rss/1024**2,2))))
