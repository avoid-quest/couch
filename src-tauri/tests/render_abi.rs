#![cfg(target_os = "linux")]

use libmpv2::render::{RenderParam, FBO};
use std::ffi::c_int;
use std::mem::{offset_of, size_of};

#[test]
fn fbo_payload_has_the_complete_native_layout() {
    type NativeFbo = libmpv2_sys::mpv_opengl_fbo;
    assert_eq!(size_of::<NativeFbo>(), 16);
    assert_eq!(offset_of!(NativeFbo, fbo), 0);
    assert_eq!(offset_of!(NativeFbo, w), 4);
    assert_eq!(offset_of!(NativeFbo, h), 8);
    assert_eq!(offset_of!(NativeFbo, internal_format), 12);
    let parameter: libmpv2_sys::mpv_render_param = RenderParam::<()>::FBO(FBO {
        fbo: 7,
        width: 1920,
        height: 1080,
    })
    .into();
    assert_eq!(parameter.type_, 3);
    // The public conversion owns this allocation until its FFI caller frees it.
    let native = unsafe { Box::from_raw(parameter.data.cast::<NativeFbo>()) };
    assert_eq!(
        (native.fbo, native.w, native.h, native.internal_format),
        (7, 1920, 1080, 0)
    );
}

#[test]
fn boolean_properties_use_c_int_storage_in_both_directions() {
    use libmpv2::{GetData, SetData};

    for value in [false, true] {
        let native = c_int::from(value);
        let observed = bool::get_from_c_void(|data| {
            // Reproduce the exact write performed for MPV_FORMAT_FLAG.
            unsafe { data.cast::<c_int>().write(native) };
            Ok(())
        })
        .unwrap();
        assert_eq!(observed, value);
        value
            .call_as_c_void(|data| {
                assert_eq!(unsafe { data.cast::<c_int>().read() }, native);
                Ok(())
            })
            .unwrap();
    }
    assert!(bool::get_from_c_void::<(), _>(|_| Err(libmpv2::Error::Raw(-1))).is_err());
}
