/*
Copyright 2024 SamanthaJo

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

// TBD
/*
The original idea here was to providing a VR/AR based interface
via WebXR. This would allow directly playing VR videos from Goon.

I tried it via AFRAME and there were issues that made it not work.
It seems better to wait for WebGPU support since it has a better story
for video than WebGL. It's also not clear what the the point of
Goon is for VR at least since you can really only deal with on VR
video at a time (not multiple videos, the point of Goon).

In AR you might be able to do more but in AR you can already open
multiple Goon windows via things like the Meta Link and further
you can just make a single window giant and have pretty much as
much room as you need for as many videos as you want.
*/
